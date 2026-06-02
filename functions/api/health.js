export async function onRequest() {
  return Response.json(
    { ok: true, status: "healthy" },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization,X-WMS-Lite-Summary"
      }
    }
  );
}
