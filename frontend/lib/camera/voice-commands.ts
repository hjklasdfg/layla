export function isCameraOnCommand(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /\bturn on (the )?camera\b/.test(lower) ||
    /\bstart (the )?camera\b/.test(lower) ||
    /\bopen (the )?camera\b/.test(lower) ||
    /\benable (the )?camera\b/.test(lower) ||
    /\bbegin recording\b/.test(lower) ||
    /\bstart recording\b/.test(lower)
  );
}

export function isCameraOffCommand(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /\bturn off (the )?camera\b/.test(lower) ||
    /\bstop (the )?camera\b/.test(lower) ||
    /\bclose (the )?camera\b/.test(lower) ||
    /\bstop recording\b/.test(lower) ||
    /\bend recording\b/.test(lower)
  );
}
