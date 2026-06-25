import { onRequestGet as __api_waitlist_ts_onRequestGet } from "/Users/okynata/Desktop/wordsmash/web/functions/api/waitlist.ts"
import { onRequestPost as __api_waitlist_ts_onRequestPost } from "/Users/okynata/Desktop/wordsmash/web/functions/api/waitlist.ts"

export const routes = [
    {
      routePath: "/api/waitlist",
      mountPath: "/api",
      method: "GET",
      middlewares: [],
      modules: [__api_waitlist_ts_onRequestGet],
    },
  {
      routePath: "/api/waitlist",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_waitlist_ts_onRequestPost],
    },
  ]