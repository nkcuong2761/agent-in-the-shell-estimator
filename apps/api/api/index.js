// Placeholder so Vercel's pre-build check finds the function named in vercel.json. `npm run bundle`
// (run by the Vercel build command) overwrites this file with the real bundle; never commit that output.
export default function handler(_req, res) {
  res.statusCode = 503;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ error: { code: 'not_built', message: 'The API bundle was not built. Run `npm run bundle` in apps/api.' } }));
}
