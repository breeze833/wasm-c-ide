import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { registerCustomApiHoverProviders } from './hover-provider.js';

self.MonacoEnvironment = {
  getWorker: function (_workerId, _label) {
    return new editorWorker();
  },
};

registerCustomApiHoverProviders(monaco);

export { monaco };
