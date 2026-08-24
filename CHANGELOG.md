# Changelog

## [1.1.0](https://github.com/henryjarend/hyundai-trip-tracker/compare/v1.0.0...v1.1.0) (2026-08-24)


### Features

* **web:** responsive layout and WCAG AA fixes ([23d1066](https://github.com/henryjarend/hyundai-trip-tracker/commit/23d10665edfa8fd8436e1cacb11a777ba5da9c87))
* **web:** responsive layout and WCAG AA fixes ([c4a9179](https://github.com/henryjarend/hyundai-trip-tracker/commit/c4a91797ab9ed52410a5d05aff2e2e0cc50a752c))


### Bug Fixes

* **deps:** update dependency @fastify/static to v10 ([37c4392](https://github.com/henryjarend/hyundai-trip-tracker/commit/37c43926f9c559f7dbb5f9dedda0cd7c6b1ade37))
* **deps:** update dependency undici to v8 ([19354c4](https://github.com/henryjarend/hyundai-trip-tracker/commit/19354c41e2e6967fd9a24c4c115142160f5754ed))

## 1.0.0 (2026-08-19)


### Features

* **api:** reject an unparseable from/to with 400 rather than 503 ([375135f](https://github.com/henryjarend/hyundai-trip-tracker/commit/375135f2be2b8dd321949cff2ad4234a9a2a0cd1))
* **api:** serve the trip archive over HTTP ([3cea552](https://github.com/henryjarend/hyundai-trip-tracker/commit/3cea552f57617ef72fcc9db5f483d67ec9654724))
* **api:** tie trip endpoints to positions by odometer, not by time ([4c8ef29](https://github.com/henryjarend/hyundai-trip-tracker/commit/4c8ef29e2287ac7711a69949f7b05de53a519627))
* **db:** add initial schema for vehicles, trips and poll runs ([f78d745](https://github.com/henryjarend/hyundai-trip-tracker/commit/f78d7457bf809f5990a2eda8ee132fb441691af2))
* **db:** add position, event and location-throttle tables ([d1ca17d](https://github.com/henryjarend/hyundai-trip-tracker/commit/d1ca17d68de59a3d5747599dfffdaf5382e5f933))
* **db:** add the repository layer for trips, vehicles and poll runs ([99879a3](https://github.com/henryjarend/hyundai-trip-tracker/commit/99879a33d7b6d636e653593ef0ad4cdfed47d9b0))
* **db:** record moving time separately from trip duration ([e215483](https://github.com/henryjarend/hyundai-trip-tracker/commit/e215483b758399ca8404b1cd6b393be8376e31bb))
* **db:** store positions and events, and persist the location throttle ([2bd1e26](https://github.com/henryjarend/hyundai-trip-tracker/commit/2bd1e2649631178ec2ed9ef6f3a75280478e162f))
* **geocode:** resolve trip coordinates to nearest town offline ([3acf64c](https://github.com/henryjarend/hyundai-trip-tracker/commit/3acf64c871ac6b11b8c2e92338d11f0fe89d0925))
* **hyundai:** add findMyCar location fetching ([b658a4a](https://github.com/henryjarend/hyundai-trip-tracker/commit/b658a4aa740f5d7c2d2a0074dcf1a02c2d65245a))
* **hyundai:** port the Bluelink API client from BetterBlueKit ([40427bf](https://github.com/henryjarend/hyundai-trip-tracker/commit/40427bf08c570833e5272c3d25841fe04d2165d0))
* **ingest:** add the trip poller and a one-shot CLI ([6acc725](https://github.com/henryjarend/hyundai-trip-tracker/commit/6acc7259fbb78f1998fa3ac4131ef6cefb9642d4))
* **ingest:** detect vehicle transitions by diffing status snapshots ([bf6ecd5](https://github.com/henryjarend/hyundai-trip-tracker/commit/bf6ecd5d82c4ff5d9e619d507c178ff93f26d1fe))
* **ingest:** gate location fetching behind a rate-limit policy ([44ba2f7](https://github.com/henryjarend/hyundai-trip-tracker/commit/44ba2f7b3fde3bd976db73c4d73e56a635747717))
* **ingest:** wire position fetching and event detection into the poller ([7db9b20](https://github.com/henryjarend/hyundai-trip-tracker/commit/7db9b203c7b688ee505f8622bedadaa64e85b1c1))
* **server:** add configuration, connection pool and migration runner ([ae5dff1](https://github.com/henryjarend/hyundai-trip-tracker/commit/ae5dff128300abc3ea582e8fc0441041320652c6))
* **web:** add the React frontend for browsing the archive ([4d7177c](https://github.com/henryjarend/hyundai-trip-tracker/commit/4d7177c394eee430625df32877ecb5a4b9ddc8eb))
* **web:** distinguish a proven trip location from a nearest guess ([be7eae4](https://github.com/henryjarend/hyundai-trip-tracker/commit/be7eae482a8c85bda24c5dffbbe7356fada4f7a9))
* **web:** filter trips and totals to a time range ([a098136](https://github.com/henryjarend/hyundai-trip-tracker/commit/a098136dca2c39e2318e0084ff94e7795e0ba733))
* **web:** surface live status and the inferred event timeline ([52198cc](https://github.com/henryjarend/hyundai-trip-tracker/commit/52198cc1949ac7329878d772d8facc9998e7614c))


### Bug Fixes

* **hyundai:** read zoned findMyCar timestamps as real instants ([1e04b9e](https://github.com/henryjarend/hyundai-trip-tracker/commit/1e04b9eb68bd279fd7ade250e5f017fe65780773))
* **poll:** fixes wording on poll retrieval ([22e8079](https://github.com/henryjarend/hyundai-trip-tracker/commit/22e80799a91e0458a1d5fe1479ec3751b77c3a8d))
