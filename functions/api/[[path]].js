import { handlePagesApiRequest } from "../_shared/pages-api.js";

export async function onRequest(context) {
  return handlePagesApiRequest(context);
}
