# Optional FFmpeg source cache

The Docker build downloads FFmpeg 9.0.2 from the upstream release server and verifies its pinned SHA-256. For an offline or unreliable network, place `ffmpeg-9.0.2.tar.xz` in this directory before building; the same checksum check remains mandatory. The archive is excluded from Git and copied only into the media build stage.

Source: https://www.ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz

SHA-256: `8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e`

The release archive signature was checked against the FFmpeg release signing key `FCF986EA15E6E293A5644F10B4322F04D67658D8`; the official mirror also verifies the signed `n9.0.2` tag.
