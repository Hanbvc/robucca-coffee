/* "Pasang di layar utama": simpan event beforeinstallprompt (Android/Chrome) untuk dipakai dari menu Akun. */
interface InstallEvent extends Event {
  prompt: () => Promise<void>;
}

let evt: InstallEvent | null = null;
let installed = false;

export function captureInstall(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    evt = e as InstallEvent;
  });
}

/** Tampilkan dialog pasang bawaan browser bila tersedia. false bila tidak ada. */
export function promptInstall(): boolean {
  if (!evt) return false;
  void evt.prompt();
  evt = null;
  return true;
}
