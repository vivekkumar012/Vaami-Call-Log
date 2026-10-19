"""FastAPI server: the browser POSTs a WebRTC offer to /api/offer, we start a bot for that connection."""
import os

import uvicorn
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv(override=True)

from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection  # noqa: E402

from bot import run_bot  # noqa: E402

ICE_SERVERS = ["stun:stun.l.google.com:19302"]

app = FastAPI(title="Vaami Pipecat bot")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")],
    allow_origin_regex=r"https://([a-z0-9-]+\.)?call-log-9z1\.pages\.dev",
    allow_methods=["*"],
    allow_headers=["*"],
)

connections: dict[str, SmallWebRTCConnection] = {}


@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/api/offer")
async def offer(request: dict, background_tasks: BackgroundTasks):
    connection = SmallWebRTCConnection(ICE_SERVERS)
    await connection.initialize(sdp=request["sdp"], type=request["type"])

    @connection.event_handler("closed")
    async def on_closed(conn: SmallWebRTCConnection):
        connections.pop(conn.pc_id, None)

    background_tasks.add_task(run_bot, connection)  # runs for the lifetime of the call
    answer = connection.get_answer()
    connections[answer["pc_id"]] = connection
    return answer


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "7860")))
