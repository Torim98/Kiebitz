import { invoke } from "@tauri-apps/api/core";

/** Spiegelt legal::LegalDoc aus dem Rust-Backend. */
export interface LegalDoc {
  id: string;
  title: string;
  bytes: number;
}

/**
 * Verzeichnis der gebündelten Rechtstexte. Im Web-Preview gibt es keine
 * Ressourcen · dann bleibt die Liste leer und die UI zeigt den Hinweis.
 */
export async function legalDocuments(): Promise<LegalDoc[]> {
  try {
    return await invoke<LegalDoc[]>("legal_documents");
  } catch {
    return [];
  }
}

/** Volltext eines Dokuments · erst beim Öffnen geladen, nicht vorab. */
export function legalDocument(id: string): Promise<string> {
  return invoke<string>("legal_document", { id });
}
