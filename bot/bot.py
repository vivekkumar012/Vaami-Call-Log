"""Pipecat voice bot: Deepgram (STT) -> Groq (LLM) -> Cartesia/ElevenLabs (TTS) over SmallWebRTC.

When the call ends, the transcript + per-stage latency are POSTed to the Cloudflare Worker.
"""
import os
import uuid
from collections import defaultdict
from datetime import datetime, timezone

import httpx
from loguru import logger

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import Frame, MetricsFrame
from pipecat.metrics.metrics import TTFBMetricsData
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.processors.transcript_processor import TranscriptProcessor
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.groq.llm import GroqLLMService
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport

SYSTEM_PROMPT = (
    "You are Vaami, a friendly voice assistant on a phone-style call. "
    "Keep every reply to one or two short sentences, in plain spoken language: "
    "no markdown, no lists, no emojis. Start by greeting the caller and asking how you can help."
)


def stage_of(processor_name: str) -> str | None:
    """Map a Pipecat processor name (e.g. 'GroqLLMService#0') to stt / llm / tts."""
    n = processor_name.lower()
    # order matters: 'sttservice' also contains the letters 'tts'
    if "stt" in n:
        return "stt"
    if "llm" in n:
        return "llm"
    if "tts" in n:
        return "tts"
    return None


class LatencyCollector(FrameProcessor):
    """Passes every frame through, and records time-to-first-byte of each service."""

    def __init__(self):
        super().__init__()
        self.samples: dict[str, list[float]] = defaultdict(list)

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(frame, MetricsFrame):
            for item in frame.data:
                if isinstance(item, TTFBMetricsData):
                    stage = stage_of(item.processor)
                    if stage:
                        self.samples[stage].append(item.value * 1000.0)  # seconds -> ms
        await self.push_frame(frame, direction)

    def summary(self) -> list[dict]:
        return [
            {"stage": s, "avg_ms": round(sum(v) / len(v), 1), "max_ms": round(max(v), 1), "samples": len(v)}
            for s, v in self.samples.items()
            if v
        ]


def build_tts():
    provider = os.getenv("TTS_PROVIDER", "cartesia").lower()
    if provider == "elevenlabs":
        from pipecat.services.elevenlabs.tts import ElevenLabsTTSService

        return ElevenLabsTTSService(
            api_key=os.environ["ELEVENLABS_API_KEY"],
            voice_id=os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM"),
        )
    from pipecat.services.cartesia.tts import CartesiaTTSService

    return CartesiaTTSService(
        api_key=os.environ["CARTESIA_API_KEY"],
        voice_id=os.getenv("CARTESIA_VOICE_ID", "71a7ad14-091c-4e8e-a314-022ece01c121"),
    )


async def save_call(payload: dict) -> None:
    url = os.getenv("WORKER_URL", "http://localhost:8787").rstrip("/") + "/calls"
    headers = {"x-api-key": os.getenv("WORKER_API_KEY", "")}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(url, json=payload, headers=headers)
        if res.status_code >= 300:
            logger.error(f"Worker rejected call: {res.status_code} {res.text}")
        else:
            logger.info(f"Call {payload['id']} saved ({len(payload['transcript'])} turns)")
    except Exception as e:  # never crash the bot because logging failed
        logger.error(f"Could not reach Worker: {e}")


async def run_bot(connection: SmallWebRTCConnection):
    call_id = str(uuid.uuid4())
    started_at = datetime.now(timezone.utc)
    turns: list[dict] = []

    transport = SmallWebRTCTransport(
        webrtc_connection=connection,
        params=TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            # Silero VAD detects when the user starts speaking -> that is what triggers interruptions
            vad_analyzer=SileroVADAnalyzer(),
        ),
    )

    stt = DeepgramSTTService(api_key=os.environ["DEEPGRAM_API_KEY"])
    llm = GroqLLMService(
        api_key=os.environ["GROQ_API_KEY"],
        model=os.getenv("GROQ_MODEL", "openai/gpt-oss-20b"),
    )
    tts = build_tts()

    context = OpenAILLMContext([{"role": "system", "content": SYSTEM_PROMPT}])
    aggregator = llm.create_context_aggregator(context)
    transcript = TranscriptProcessor()
    latency = LatencyCollector()

    pipeline = Pipeline(
        [
            transport.input(),
            stt,
            transcript.user(),  # user turns
            aggregator.user(),
            llm,
            tts,
            transport.output(),
            latency,
            transcript.assistant(),  # bot turns (what was actually spoken)
            aggregator.assistant(),
        ]
    )

    # Interruptions are on by default (allow_interruptions=True): when VAD hears the user
    # while the bot is speaking, Pipecat cancels the bot's audio and LLM/TTS output.
    task = PipelineTask(pipeline, params=PipelineParams(enable_metrics=True))

    @transcript.event_handler("on_transcript_update")
    async def on_transcript_update(_processor, frame):
        for m in frame.messages:
            turns.append({"role": m.role, "content": m.content, "timestamp": m.timestamp})

    @transport.event_handler("on_client_connected")
    async def on_connected(_transport, _client):
        logger.info("Client connected - bot greets first")
        try:
            from pipecat.frames.frames import LLMRunFrame

            await task.queue_frames([LLMRunFrame()])
        except ImportError:  # older Pipecat
            await task.queue_frames([aggregator.user().get_context_frame()])

    @transport.event_handler("on_client_disconnected")
    async def on_disconnected(_transport, _client):
        logger.info("Client disconnected")
        await task.cancel()

    try:
        await PipelineRunner(handle_sigint=False).run(task)
    finally:
        ended_at = datetime.now(timezone.utc)
        await save_call(
            {
                "id": call_id,
                "started_at": started_at.isoformat(),
                "ended_at": ended_at.isoformat(),
                "duration_seconds": round((ended_at - started_at).total_seconds(), 2),
                "transcript": turns,
                "metrics": latency.summary(),
            }
        )
