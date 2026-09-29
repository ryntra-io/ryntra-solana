import { redirect } from "next/navigation";

/**
 * `/solana` goes to the workspace, for now.
 *
 * A temporary redirect on purpose: the public reviewer-first Solana landing is
 * a later packet in the program, and the day it ships this route serves it.
 * Making today's redirect permanent would teach caches a claim with an
 * expiry date.
 */
export default function SolanaIndexPage() {
  redirect("/solana/workspace");
}
