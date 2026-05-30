import { useRef } from "react";

const makePrimitiveKeyPart = (part: unknown): string => {
  if (part === null) return "null";
  if (part === undefined) return "undefined";
  return `${typeof part}:${String(part)}`;
};

export const useStableReferenceKey = (parts: readonly unknown[]): string => {
  const objectIdsRef = useRef<WeakMap<object, number>>(new WeakMap());
  const nextObjectIdRef = useRef(1);

  return parts
    .map((part) => {
      if (
        (typeof part !== "object" && typeof part !== "function") ||
        part === null
      ) {
        return makePrimitiveKeyPart(part);
      }

      const objectPart = part as object;
      const existingId = objectIdsRef.current.get(objectPart);
      if (existingId !== undefined) {
        return `ref:${existingId}`;
      }

      const nextId = nextObjectIdRef.current;
      nextObjectIdRef.current += 1;
      objectIdsRef.current.set(objectPart, nextId);
      return `ref:${nextId}`;
    })
    .join("|");
};
