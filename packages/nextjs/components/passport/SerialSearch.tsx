"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";

/** Jumps straight to a passport by serial number. */
export const SerialSearch = () => {
  const router = useRouter();
  const [serial, setSerial] = useState("");

  const trimmed = serial.trim();
  const valid = /^\d+$/.test(trimmed) && Number(trimmed) >= 1;

  return (
    <form
      className="join w-full max-w-md"
      onSubmit={event => {
        event.preventDefault();
        if (valid) router.push(`/verify/${trimmed}`);
      }}
    >
      <input
        className="input input-bordered join-item grow"
        placeholder="Look up a serial number"
        inputMode="numeric"
        value={serial}
        onChange={event => setSerial(event.target.value)}
        aria-label="Serial number"
      />
      <button type="submit" className="btn btn-primary join-item" disabled={!valid}>
        <MagnifyingGlassIcon className="h-4 w-4" />
        Verify
      </button>
    </form>
  );
};
