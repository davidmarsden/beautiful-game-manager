# Shared club identity and route contract

The Beautiful Game (TBG) is the private, live fantasy world. The Pink Final (TPF) is the public real-world database. A club may exist in both products, but its players, division, manager and current state are not shared.

## Product routes

The branded public origin is `https://thebeautifulgame.online`.

TBG remains the authenticated application at the root origin. TPF is independently published from `beautiful-game-data`, but is exposed to users through the branded `/pink-final/` namespace. The Netlify application may reverse-proxy that namespace to the independent TPF static origin; the upstream hosting URL is an implementation detail and must not be used as the canonical public route.

TPF front page:

```text
https://thebeautifulgame.online/pink-final/
```

TPF player profile route:

```text
https://thebeautifulgame.online/pink-final/players/?id=<tbg_player_id>
```

TPF club profile route:

```text
https://thebeautifulgame.online/pink-final/clubs/?id=<club_id>
```

TBG authenticated entry route:

```text
https://thebeautifulgame.online/?club=<club_id>
```

Keeping TPF's publication pipeline independent is deliberate. A future dedicated Pink Final domain or subdomain may replace the `/pink-final/` public namespace without changing the durable identity contract below.

## Identity

`club_id` is the durable canonical identity. It must not be derived from the club's display name, current division, league position or manager appointment. Promotion, relegation and display-label changes therefore do not change either route.

A governed `pink_final_club_route_key` may override the public lookup key when a data migration requires it. A governed `pink_final_club_profile_url` may override the whole TPF URL. Generic club website or provider URLs are never treated as Pink Final routes.

## Permission boundary

The TPF-to-TBG link is an authenticated entrance, not a public squad link. It contains only the stable club ID. It must never contain or expose:

- world IDs;
- manager or appointment IDs;
- season IDs;
- squad IDs, player lists or private club state.

After sign-in, TBG resolves the stable club ID against the manager's permitted canonical world and opens the existing read-only club inspection. The `/api/history` response remains bearer-authenticated and `no-store`.

TPF should label the reverse action **Open in The Beautiful Game**, not **View current TBG squad**. The latter wrongly suggests that a public page identifies or publishes one private world's current squad.

## Display rules

TBG shows **View in The Pink Final** only when the canonical club record projects a published Pink Final URL.

TPF should show **Open in The Beautiful Game** only when its public club record has a stable shared club ID. The destination is the private TBG application entry route; authentication and world access remain authoritative.
