import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

self.MonacoEnvironment = {
  getWorker: function (_workerId, _label) {
    return new editorWorker();
  },
};

export { monaco };
