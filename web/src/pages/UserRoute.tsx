import { Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Spinner, ErrorState } from "../components/ui";
import { normAddr } from "../lib/format";

/** /u/:username -> resolve the username to an address and redirect to /profile/:address. */
export function UserRoute() {
  const { username = "" } = useParams();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["user", username.toLowerCase()],
    queryFn: () => api.userByName(username),
    enabled: username !== "",
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> Loading…
      </div>
    );
  }
  if (isError || !data) {
    return <ErrorState message={`No user found for @${username}.`} onRetry={() => void refetch()} />;
  }
  return <Navigate to={`/profile/${normAddr(data.address)}`} replace />;
}
