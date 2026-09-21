import { permanentRedirect } from "next/navigation";

/**
 * GS1 Digital Link resolver.
 *
 * `/01/{gtin}/21/{serial}` is the URI format retail and DPP scanners already
 * understand, so a passport QR can carry a standards-compliant link rather than
 * an app-specific one. The GTIN identifies the product model and the serial
 * identifies the individual item; this app keys everything on the serial, so
 * the GTIN is carried for the scanner's benefit and the request is redirected.
 */
export default async function Gs1DigitalLink({ params }: { params: Promise<{ gtin: string; serial: string }> }) {
  const { serial } = await params;
  permanentRedirect(`/verify/${serial}`);
}
