import { parseDocument } from "./model.js";

self.onmessage = ({ data }) => {
  try {
    self.postMessage({ board: parseDocument(data).board });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
