/** Static export -> the "out/" folder is what Cloudflare Pages hosts. */
const nextConfig = {
  output: "export",
  images: { unoptimized: true },
};
export default nextConfig;
