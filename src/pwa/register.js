export async function registerUnsServiceWorker() {
  if (__GITHUB_PAGES__ || !('serviceWorker' in navigator)) return;
  const { registerSW } = await import('virtual:pwa-register');
  registerSW({
    immediate: true,
  });
}
