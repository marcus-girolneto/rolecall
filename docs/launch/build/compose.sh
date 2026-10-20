#!/bin/bash
# Usage: bash compose.sh <en|pt> <output.mp4>
set -euo pipefail
L=$1; OUT=$2
V=(-c:v libx264 -pix_fmt yuv420p -r 30 -preset medium -crf 20 -an)
ffmpeg -v error -y -loop 1 -t 4.5 -i "$L/open.png" -vf "fade=in:0:12,fade=out:st=4.1:d=0.4,format=yuv420p" "${V[@]}" s0.mp4
ffmpeg -v error -y -f lavfi -i color=c=0x0f1016:s=1920x1080:r=30 -i terminal.mp4 -i "$L/cap1.png" -i "$L/cap2.png" -i "$L/cap3.png" -filter_complex \
  "[1:v]scale=1600:-2[t];[0:v][t]overlay=(W-w)/2:14:shortest=1[b];[b][2:v]overlay=0:0:enable='lt(t,8.5)'[c1];[c1][3:v]overlay=0:0:enable='between(t,8.5,18.5)'[c2];[c2][4:v]overlay=0:0:enable='gte(t,18.5)',fade=in:0:8" \
  "${V[@]}" s1.mp4
for spec in "overview 5 cap4" "policy 6 cap5" "attack 7 cap6"; do
  set -- $spec
  F=$(( $2 * 30 ))
  ffmpeg -v error -y -i "dash-$1.png" -i "$L/$3.png" -filter_complex \
    "[0:v]scale=3840:-2,zoompan=z='min(1.0+0.0004*on,1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=$F:s=1920x1080:fps=30[z];[z][1:v]overlay=0:0,fade=in:0:8" \
    "${V[@]}" "s-$1.mp4"
done
ffmpeg -v error -y -loop 1 -t 5 -i "$L/end.png" -vf "fade=in:0:12,format=yuv420p" "${V[@]}" s9.mp4
printf "file '%s'\n" s0.mp4 s1.mp4 s-overview.mp4 s-policy.mp4 s-attack.mp4 s9.mp4 > list.txt
ffmpeg -v error -y -f concat -safe 0 -i list.txt -c copy video-only.mp4
# Original soundtrack (soundtrack.mjs), loudness-normalised for social video.
ffmpeg -v error -y -i video-only.mp4 -i soundtrack.wav -map 0:v -map 1:a -c:v copy \
  -af "loudnorm=I=-16:TP=-1.5:LRA=11" -c:a aac -b:a 192k -ar 48000 -shortest -movflags +faststart "$OUT"
ffprobe -v error -show_entries format=duration,size -of default=nw=1 "$OUT"
