'use client';
/**
 * "There is typing on this screen that is not saved yet" — set by the request form,
 * read by the Refresh button so a reload does not throw the work away unasked.
 */
let dirty = false;
export const setDirty = (v: boolean) => { dirty = v; };
export const isDirty = () => dirty;
