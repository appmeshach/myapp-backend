import { measure, cases } from '../0099-geographic-support-benchmark.mjs';
Deno.serve((request) => {
  const name = new URL(request.url).searchParams.get('case');
  if (!name || !(name in cases)) return new Response(null, { status: 400 });
  return Response.json(measure(name));
});
