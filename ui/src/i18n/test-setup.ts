// Unit tests call view code directly (imports, updates, stats words): load those words once.
import { loadViewWords } from ".";

await loadViewWords();
