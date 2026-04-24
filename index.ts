import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  InputRenderable,
  SelectRenderableEvents,
  InputRenderableEvents,
  type CliRenderer,
  type SelectOption,
} from "@opentui/core";
import {
  readdirSync,
  statSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { join, basename, extname } from "node:path";
import { homedir } from "node:os";

const NOTES_DIR = process.env.NOTEUI_DIR ?? join(homedir(), "notes");

let renderer: CliRenderer | null = null;
let selectElement: SelectRenderable | null = null;
let newNoteContainer: BoxRenderable | null = null;
let newNoteInput: InputRenderable | null = null;
let statusText: TextRenderable | null = null;
let keyboardHandler: ((key: any) => void) | null = null;
let noteContainer: BoxRenderable | null = null;
let deleteConfirmNote: string | null = null;
let deleteConfirmTimer: Timer | null = null;
let statusRevertTimer: Timer | null = null;
let lastSelectedPath: string | null = null;

const DEFAULT_STATUS =
  "j/k: navigate | Enter: open | n: new | d: delete | r: refresh | q: quit";

function getNoteFiles(): string[] {
  if (!existsSync(NOTES_DIR)) {
    mkdirSync(NOTES_DIR, { recursive: true });
  }
  try {
    const entries = readdirSync(NOTES_DIR);
    return entries
      .filter((f) => extname(f) === ".md")
      .map((f) => join(NOTES_DIR, f))
      .sort(
        (a, b) => statSync(b).mtime.getTime() - statSync(a).mtime.getTime(),
      );
  } catch {
    return [];
  }
}

function getNoteOptions(): SelectOption[] {
  const files = getNoteFiles();
  if (files.length === 0) {
    return [
      {
        name: "(no notes yet)",
        description: "Press 'n' to create one",
        value: null,
      },
    ];
  }
  return files.map((f) => ({
    name: basename(f, ".md"),
    description: f,
    value: f,
  }));
}

function getSelectedIndex(): number {
  if (!lastSelectedPath) return 0;
  const options = getNoteOptions();
  const idx = options.findIndex((o) => o.value === lastSelectedPath);
  return idx >= 0 ? idx : 0;
}

async function openNote(path: string): Promise<void> {
  lastSelectedPath = path;

  // Destroy renderer to hand terminal back to the shell
  if (renderer) {
    renderer.destroy();
    renderer = null;
  }

  // Run nvim and block until it exits
  const proc = Bun.spawn(["nvim", path], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  await proc.exited;

  // nvim closed — restart the sidebar
  await run();
}

function createNote(filename: string): void {
  const name = filename.trim().replace(/\s+/g, "-");
  if (!name) return;
  const path = join(
    NOTES_DIR,
    name.endsWith(".md") ? name : `${name}.md`,
  );
  if (existsSync(path)) {
    flashStatus(`Note already exists: ${basename(path, ".md")}`);
    return;
  }
  try {
    Bun.write(path, "");
    lastSelectedPath = path;
    refreshNotes();
    flashStatus(`Created: ${basename(path, ".md")}`);
  } catch {
    flashStatus("Failed to create note.");
  }
}

function deleteCurrentNote(): void {
  if (!selectElement) return;
  const option = selectElement.getSelectedOption();
  if (!option?.value) {
    flashStatus("Nothing to delete.");
    return;
  }

  const noteName = option.name;

  if (deleteConfirmNote !== noteName) {
    deleteConfirmNote = noteName;
    if (statusRevertTimer) clearTimeout(statusRevertTimer);
    statusRevertTimer = null;
    updateStatus(`Press 'd' again to delete: ${noteName}`);
    if (deleteConfirmTimer) clearTimeout(deleteConfirmTimer);
    deleteConfirmTimer = setTimeout(() => {
      deleteConfirmNote = null;
      updateStatus(DEFAULT_STATUS);
    }, 3000);
    return;
  }

  deleteConfirmNote = null;
  if (deleteConfirmTimer) {
    clearTimeout(deleteConfirmTimer);
    deleteConfirmTimer = null;
  }

  try {
    unlinkSync(option.value as string);
    refreshNotes();
    flashStatus(`Deleted: ${noteName}`);
  } catch {
    flashStatus("Failed to delete note.");
  }
}

function refreshNotes(): void {
  if (!noteContainer || !renderer) return;

  if (selectElement) {
    noteContainer.remove(selectElement.id);
    selectElement.destroy();
    selectElement = null;
  }

  const noteOptions = getNoteOptions();
  const startIndex = getSelectedIndex();

  const noteCount = noteOptions.length;
  const maxAvailableHeight = renderer.terminalHeight - 5;
  const listHeight = Math.max(1, Math.min(noteCount, maxAvailableHeight));

  selectElement = new SelectRenderable(renderer, {
    id: "note-list",
    width: "auto",
    height: listHeight,
    options: noteOptions,
    selectedIndex: startIndex,
    backgroundColor: "transparent",
    focusedBackgroundColor: "#313244",
    textColor: "#cdd6f4",
    focusedTextColor: "#cdd6f4",
    selectedBackgroundColor: "#45475a",
    selectedTextColor: "#89b4fa",
    descriptionColor: "transparent",
    selectedDescriptionColor: "transparent",
    showDescription: false,
    showScrollIndicator: true,
    wrapSelection: false,
  });

  noteContainer.add(selectElement);

  selectElement.on(
    SelectRenderableEvents.ITEM_SELECTED,
    (_index: number, option: SelectOption) => {
      if (option.value && typeof option.value === "string") {
        // Defer so SelectRenderable finishes its internal handling
        // before we tear down the renderer.
        setTimeout(() => openNote(option.value), 0);
      }
    },
  );

  selectElement.focus();
}

function updateStatus(msg: string): void {
  if (statusText) {
    statusText.content = msg;
  }
}

function flashStatus(msg: string, duration = 2000): void {
  updateStatus(msg);
  if (statusRevertTimer) clearTimeout(statusRevertTimer);
  statusRevertTimer = setTimeout(() => {
    updateStatus(DEFAULT_STATUS);
  }, duration);
}

function showNewNoteInput(): void {
  if (!newNoteContainer || !newNoteInput || !renderer) return;
  newNoteContainer.visible = true;
  newNoteInput.focus();
  // Clear on next tick so the key that triggered this (e.g. 'n') isn't captured
  setTimeout(() => {
    if (newNoteInput) newNoteInput.value = "";
  }, 0);
  if (statusRevertTimer) clearTimeout(statusRevertTimer);
  statusRevertTimer = null;
  updateStatus("Enter filename, then press Enter. Esc to cancel.");
}

function hideNewNoteInput(): void {
  if (!newNoteContainer || !newNoteInput || !selectElement) return;
  newNoteContainer.visible = false;
  newNoteInput.blur();
  selectElement.focus();
  updateStatus(DEFAULT_STATUS);
}

function setup(rendererInstance: CliRenderer): void {
  renderer = rendererInstance;
  renderer.setBackgroundColor("#1e1e2e");

  const container = new BoxRenderable(renderer, {
    id: "container",
    width: "auto",
    height: "auto",
    flexDirection: "column",
    backgroundColor: "#1e1e2e",
    padding: 1,
    gap: 1,
  });

  const title = new TextRenderable(renderer, {
    id: "title",
    content: " NOTEUI ",
    fg: "#89b4fa",
    bg: "transparent",
  });
  container.add(title);

  noteContainer = new BoxRenderable(renderer, {
    id: "note-container",
    width: "auto",
    height: "auto",
    flexGrow: 1,
    flexDirection: "column",
    backgroundColor: "transparent",
  });
  container.add(noteContainer);

  statusText = new TextRenderable(renderer, {
    id: "status",
    content:
      "j/k: navigate | Enter: open | n: new | d: delete | r: refresh | q: quit",
    fg: "#6c7086",
    bg: "transparent",
    height: 1,
  });
  container.add(statusText);

  newNoteContainer = new BoxRenderable(renderer, {
    id: "new-note-container",
    position: "absolute",
    left: 2,
    top: 3,
    width: "80%",
    height: 3,
    backgroundColor: "#313244",
    border: true,
    borderStyle: "single",
    borderColor: "#89b4fa",
    visible: false,
    zIndex: 100,
    flexDirection: "column",
    padding: 1,
  });

  newNoteInput = new InputRenderable(renderer, {
    id: "new-note-input",
    width: "auto",
    backgroundColor: "transparent",
    textColor: "#cdd6f4",
    placeholder: "filename...",
    placeholderColor: "#6c7086",
    cursorColor: "#89b4fa",
    value: "",
  });
  newNoteContainer.add(newNoteInput);

  renderer.root.add(container);
  renderer.root.add(newNoteContainer);

  newNoteInput.on(InputRenderableEvents.ENTER, (value: string) => {
    hideNewNoteInput();
    createNote(value);
  });

  refreshNotes();

  keyboardHandler = (key: any) => {
    const isInputVisible = newNoteContainer?.visible ?? false;

    if (isInputVisible) {
      if (key.name === "escape") {
        hideNewNoteInput();
      }
      return;
    }

    if (key.name === "q") {
      rendererInstance.destroy();
      process.exit(0);
    }
    if (key.name === "n") {
      showNewNoteInput();
      return;
    }
    if (key.name === "d") {
      deleteCurrentNote();
      return;
    }
    if (key.name === "r") {
      refreshNotes();
      flashStatus("Refreshed.");
      return;
    }
  };

  rendererInstance.keyInput.on("keypress", keyboardHandler);
}

function cleanup(): void {
  if (keyboardHandler && renderer) {
    renderer.keyInput.off("keypress", keyboardHandler);
  }
  keyboardHandler = null;
  selectElement = null;
  newNoteContainer = null;
  newNoteInput = null;
  statusText = null;
  noteContainer = null;
  renderer = null;
  if (deleteConfirmTimer) {
    clearTimeout(deleteConfirmTimer);
    deleteConfirmTimer = null;
  }
  if (statusRevertTimer) {
    clearTimeout(statusRevertTimer);
    statusRevertTimer = null;
  }
  deleteConfirmNote = null;
}

async function run(): Promise<void> {
  const cliRenderer = await createCliRenderer({
    exitOnCtrlC: true,
  });

  setup(cliRenderer);

  cliRenderer.on("destroy", () => {
    cleanup();
  });
}

await run();
