// Unit tests for unified prompt-safe LineEditor
import assert from 'node:assert';
import { LineEditor } from '../src/terminal/line-editor.js';

console.log('--- Running LineEditor Unit Tests ---');

// Test 1: Basic text insertion and cursor movement
{
  let output = '';
  const editor = new LineEditor({ write: (s) => { output += s; }, historyContext: 'test1' });
  editor.feed('h');
  editor.feed('e');
  editor.feed('l');
  editor.feed('l');
  editor.feed('o');

  assert.strictEqual(editor.getBuffer(), 'hello');
  assert.strictEqual(editor.getCursor(), 5);
  assert.strictEqual(output, 'hello');
  console.log('✓ Basic text insertion and cursor tracking verified');
}

// Test 2: In-line cursor navigation with Left and Right arrows
{
  let output = '';
  const editor = new LineEditor({ write: (s) => { output += s; }, historyContext: 'test2' });
  editor.feed('test');
  assert.strictEqual(editor.getCursor(), 4);

  // Left arrow
  editor.feed('\x1b[D');
  assert.strictEqual(editor.getCursor(), 3);
  editor.feed('\x1b[D');
  assert.strictEqual(editor.getCursor(), 2);

  // Insert in middle
  editor.feed('X');
  assert.strictEqual(editor.getBuffer(), 'teXst');
  assert.strictEqual(editor.getCursor(), 3);

  // Right arrow
  editor.feed('\x1b[C');
  assert.strictEqual(editor.getCursor(), 4);

  // Clamp at end
  editor.feed('\x1b[C');
  editor.feed('\x1b[C');
  assert.strictEqual(editor.getCursor(), 5);

  console.log('✓ In-line cursor navigation (Left/Right) and middle insertion verified');
}

// Test 3: Backspace and Delete
{
  let output = '';
  const editor = new LineEditor({ write: (s) => { output += s; }, historyContext: 'test3' });
  editor.feed('abc');

  // Backspace at end
  editor.feed('\x7f');
  assert.strictEqual(editor.getBuffer(), 'ab');
  assert.strictEqual(editor.getCursor(), 2);

  // Move left to col 1 (between 'a' and 'b')
  editor.feed('\x1b[D');
  assert.strictEqual(editor.getCursor(), 1);

  // Delete at cursor (deletes 'b')
  editor.feed('\x1b[3~');
  assert.strictEqual(editor.getBuffer(), 'a');
  assert.strictEqual(editor.getCursor(), 1);

  console.log('✓ Backspace and Delete editing verified');
}

// Test 4: Home and End
{
  const editor = new LineEditor({ write: () => {}, historyContext: 'test4' });
  editor.feed('echo hello');
  assert.strictEqual(editor.getCursor(), 10);

  // Home key (\x1b[H or Ctrl+A)
  editor.feed('\x1b[H');
  assert.strictEqual(editor.getCursor(), 0);

  // End key (\x1b[F or Ctrl+E)
  editor.feed('\x1b[F');
  assert.strictEqual(editor.getCursor(), 10);

  // Ctrl+A and Ctrl+E
  editor.feed('\x01');
  assert.strictEqual(editor.getCursor(), 0);
  editor.feed('\x05');
  assert.strictEqual(editor.getCursor(), 10);

  console.log('✓ Home, End, Ctrl+A, and Ctrl+E verified');
}

// Test 5: Ctrl+K and Ctrl+U
{
  const editor = new LineEditor({ write: () => {}, historyContext: 'test5' });
  editor.feed('first second');

  // Move cursor back 6 chars (to 'first ')
  for (let i = 0; i < 6; i++) editor.feed('\x1b[D');
  assert.strictEqual(editor.getCursor(), 6);

  // Ctrl+K (kill to end)
  editor.feed('\x0b');
  assert.strictEqual(editor.getBuffer(), 'first ');
  assert.strictEqual(editor.getCursor(), 6);

  // Ctrl+U (clear line)
  editor.feed('\x15');
  assert.strictEqual(editor.getBuffer(), '');
  assert.strictEqual(editor.getCursor(), 0);

  console.log('✓ Ctrl+K (kill to end) and Ctrl+U (clear line) verified');
}

// Test 6: History navigation with Up and Down arrows
{
  const editor = new LineEditor({ write: () => {}, historyContext: 'test_sql' });
  editor.feed('SELECT 1;');
  editor.commitHistory();
  editor.reset();

  editor.feed('SELECT 2;');
  editor.commitHistory();
  editor.reset();

  // Type scratch input
  editor.feed('SEL');
  assert.strictEqual(editor.getBuffer(), 'SEL');

  // Up arrow -> recalls 'SELECT 2;'
  editor.feed('\x1b[A');
  assert.strictEqual(editor.getBuffer(), 'SELECT 2;');
  assert.strictEqual(editor.getCursor(), 9);

  // Up arrow again -> recalls 'SELECT 1;'
  editor.feed('\x1b[A');
  assert.strictEqual(editor.getBuffer(), 'SELECT 1;');
  assert.strictEqual(editor.getCursor(), 9);

  // Down arrow -> moves forward to 'SELECT 2;'
  editor.feed('\x1b[B');
  assert.strictEqual(editor.getBuffer(), 'SELECT 2;');

  // Down arrow again -> restores scratch 'SEL'
  editor.feed('\x1b[B');
  assert.strictEqual(editor.getBuffer(), 'SEL');

  console.log('✓ History recall (Up/Down) and scratch line restoration verified');
}

// Test 7: Contextual history isolation
{
  const sqlEditor = new LineEditor({ write: () => {}, historyContext: 'ctx_sql' });
  sqlEditor.feed('CREATE TABLE t (id INT);');
  sqlEditor.commitHistory();
  sqlEditor.reset();

  const shEditor = new LineEditor({ write: () => {}, historyContext: 'ctx_sh' });
  shEditor.feed('gcc main.c');
  shEditor.commitHistory();
  shEditor.reset();

  // sqlEditor recalls SQL, not shell
  sqlEditor.feed('\x1b[A');
  assert.strictEqual(sqlEditor.getBuffer(), 'CREATE TABLE t (id INT);');

  // shEditor recalls shell, not SQL
  shEditor.feed('\x1b[A');
  assert.strictEqual(shEditor.getBuffer(), 'gcc main.c');

  console.log('✓ Contextual history isolation verified');
}

// Test 8: Enter, Ctrl-C, and Ctrl-D hooks
{
  let lineCommitted = null;
  let eofCalled = false;
  let interruptCalled = false;

  const editor = new LineEditor({
    write: () => {},
    historyContext: 'test_hooks',
    onLine: (line) => { lineCommitted = line; },
    onEof: () => { eofCalled = true; },
    onInterrupt: () => { interruptCalled = true; },
  });

  editor.feed('quit');
  editor.feed('\r');
  assert.strictEqual(lineCommitted, 'quit');
  assert.strictEqual(editor.getBuffer(), '');

  editor.feed('\x04');
  assert.strictEqual(eofCalled, true);

  editor.feed('\x03');
  assert.strictEqual(interruptCalled, true);

  console.log('✓ Enter onLine, Ctrl-D onEof, and Ctrl-C onInterrupt hooks verified');
}

console.log('--- ALL LINE EDITOR TESTS PASSED ---');
