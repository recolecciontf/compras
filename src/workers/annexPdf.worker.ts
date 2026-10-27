// One isolated conversion per worker also prevents image/font state leaking
// between consecutive exports. No document is sent to an external converter.
self.onmessage = async (event: MessageEvent<{ bytes: ArrayBuffer; moduleUrl: string }>) => {
  try {
    const module = await import(/* @vite-ignore */ event.data.moduleUrl);
    const result = await module.Ream.parse(new Uint8Array(event.data.bytes)).convertWithReport("pdf");
    const bytes = new Uint8Array(result.bytes).slice().buffer;
    self.postMessage({ bytes }, { transfer: [bytes] });
  } catch {
    self.postMessage({ error: "No se ha podido generar el PDF del anexo. Descárgalo en Word y vuelve a intentarlo." });
  }
};
