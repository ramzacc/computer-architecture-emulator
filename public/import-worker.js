import { parseProject } from "./project-file.js";

self.onmessage = ({ data }) => {
  try {
    self.postMessage(parseProject(data));
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
