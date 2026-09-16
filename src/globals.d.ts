// Next generates next-env.d.ts at build time and it is gitignored, so declare
// the asset modules we actually import here. This keeps `npm run typecheck`
// working on a fresh clone before the first build has run.
declare module "*.css";
