/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "export",
  // On GitHub Pages (https://<user>.github.io/<repo>/), NEXT_PUBLIC_BASE_PATH is set
  // to "/<repo>" so CSS/JS asset URLs resolve under the repository subpath.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
};

export default nextConfig;
