import productionWorker from "./index";
import { createMemoryBackend } from "../sync/routes";

const verificationBackend = createMemoryBackend();

export default {
  fetch(request: Request): Promise<Response> {
    return productionWorker.fetch(request, { RECALLBASE_BACKEND: verificationBackend });
  }
};
