export async function* streamLines(stream, limit = 128_000) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream:!done });
      let index;
      while ((index = pending.indexOf('\n')) !== -1) {
        if (index > limit) throw new Error('AI yanıt satırı çok büyük.');
        yield pending.slice(0,index).replace(/\r$/, '');
        pending = pending.slice(index + 1);
      }
      if (pending.length > limit) throw new Error('AI yanıt satırı çok büyük.');
      if (done) break;
    }
    if (pending) yield pending;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
