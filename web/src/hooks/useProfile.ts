import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { normAddr } from "../lib/format";
import type { Profile } from "@shared/types";

/** Canonical query key for a profile, keyed on the lowercased address. */
export function profileKey(address: string) {
  return ["profile", normAddr(address)] as const;
}

/**
 * Fetch a full profile. Used by the profile page directly; UserBadge uses a
 * lighter selector but shares the same cache entry so there is one fetch per addr.
 */
export function useProfile(address: string | undefined, enabled = true) {
  return useQuery({
    queryKey: profileKey(address ?? ""),
    queryFn: () => api.profile(address as string),
    enabled: Boolean(address) && enabled,
    retry: 1,
  });
}

/** Just the display fields for a badge — shares the profile cache entry. */
export function useProfileMeta(address: string | undefined) {
  return useQuery({
    queryKey: profileKey(address ?? ""),
    queryFn: () => api.profile(address as string),
    enabled: Boolean(address),
    retry: 0,
    staleTime: 60_000,
    select: (p: Profile) => p.meta,
  });
}
