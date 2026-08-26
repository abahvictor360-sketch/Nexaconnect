/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['better-sqlite3'],

  // The chat moved from /chat to /. Redirect rather than drop it: the old path
  // is in the README, in earlier deploy previews and in anything already
  // bookmarked.
  async redirects() {
    return [{ source: '/chat', destination: '/', permanent: true }];
  },
};

export default nextConfig;
