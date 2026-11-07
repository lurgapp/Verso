#!/bin/sh
set -eu
# Archive signature was verified against the upstream FFmpeg release signing key.
# n9.0.2: signed tag ce8f11b9fac4cd7ccfb41ca7c01bc17f5cda8cc3.
version=9.0.2
checksum=8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
archive="$work/ffmpeg.tar.xz"
cached="/tmp/verso-media-source/ffmpeg-$version.tar.xz"
if [ -f "$cached" ]; then
  cp "$cached" "$archive"
else
  curl -fLsS --retry 3 --retry-all-errors --connect-timeout 15 --max-time 120 "https://www.ffmpeg.org/releases/ffmpeg-$version.tar.xz" -o "$archive"
fi
printf '%s  %s\n' "$checksum" "$archive" | sha256sum -c -
tar -xJf "$archive" -C "$work"
cd "$work/ffmpeg-$version"
./configure --prefix=/opt/ffmpeg --extra-version=verso-restricted \
  --disable-autodetect --disable-everything --disable-doc --disable-debug \
  --disable-network --disable-avdevice --disable-ffplay \
  --enable-static --disable-shared --pkg-config-flags=--static \
  --enable-gpl --enable-libx264 --enable-libdav1d --enable-zlib \
  --enable-ffmpeg --enable-ffprobe --enable-pthreads \
  --enable-protocol=file,pipe \
  --enable-demuxer=mov,matroska,apng \
  --enable-muxer=mp4,mov,image2,rawvideo,null \
  --enable-decoder=h264,hevc,vp8,vp9,libdav1d,aac,mp3,opus,vorbis,png,apng \
  --enable-encoder=libx264,aac,png,rawvideo \
  --enable-parser=h264,hevc,vp8,vp9,av1,aac,mpegaudio,opus,vorbis,png \
  --enable-bsf=extract_extradata,h264_mp4toannexb,hevc_mp4toannexb,aac_adtstoasc,vp9_superframe \
  --enable-filter=scale,format,pad,setsar,fps,aresample,aformat,null,anull,transpose,hflip,vflip,rotate,trim,setpts,atrim,asetpts,buffer,buffersink,abuffer,abuffersink
nice -n 10 make -j2
make install
# FFmpeg libraries are static; shared dependencies are limited to the audited
# x264/dav1d/zlib and C runtime. No distro FFmpeg or XML stack is required.
mkdir -p /opt/ffmpeg/share/verso-media
cp COPYING.GPLv2 COPYING.GPLv3 /opt/ffmpeg/share/verso-media/
ldd /opt/ffmpeg/bin/ffmpeg /opt/ffmpeg/bin/ffprobe > /opt/ffmpeg/share/verso-media/linked-libraries.txt
if grep -Eq "lib(xml2|avcodec|avformat|avfilter|avdevice|swscale|swresample)" /opt/ffmpeg/share/verso-media/linked-libraries.txt; then exit 1; fi
printf 'FFmpeg %s\narchive SHA256 %s\n' "$version" "$checksum" > /opt/ffmpeg/share/verso-media/source.txt
dpkg-query -W > /opt/ffmpeg/share/verso-media/build-packages.txt
