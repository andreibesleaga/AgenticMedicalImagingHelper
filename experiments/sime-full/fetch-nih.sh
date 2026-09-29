#!/usr/bin/env bash
# Resumable, verified download of the NIH ChestX-ray14 archives (public Box links
# published by the NIH Clinical Center): retries each one
# until `gzip -t` passes. Run it inside the directory that should hold the archives:
#   cd ../nih-cxr14-full/archives && bash <repo>/experiments/sime-full/fetch-nih.sh 1
# Archive 1 holds the E4 cohort (verified). E4L-20 is estimated to need 2 3 5 7 8 9 10 11
# and E2 all 12 (from file-name ranges; prepare-nih-full.py reports anything missing).
# Works in the current directory.
ids=(vfk49d74nhbxq3nqjg0900w5nvkorp5c i28rlmbvmfjbl8p2n3ril0pptcmcu9d1 f1t00wrtdk94satdfb9olcolqx20z2jp
     0aowwzs5lhjrceb3qp67ahp0rd1l1etg v5e3goj22zr6h8tzualxfsqlqaygfbsn asi7ikud9jwnkrnkj99jnpfkjdes7l6l
     jn1b4mw4n6lnh74ovmcjb8y48h8xj07n tvpxmn7qyrgl0w8wfh9kqfjskv6nmm1j upyy3ml7qdumlgk2rfcvlb9k6gvqq2pj
     l6nilvfa9cg3s28tqv1qc1olm3gnz54p hhq8fkdgvcari67vfhs7ppg2w6ni4jze ioqwiy20ihqwyr8pf4c24eazhh281pbu)
for n in "$@"; do
  f=$(printf "images_%03d.tar.gz" "$n")
  u="https://nihcc.box.com/shared/static/${ids[$((n-1))]}.gz"
  for try in $(seq 1 300); do
    if gzip -t "$f" 2>/dev/null; then echo "OK $f $(stat -c %s "$f") after $try attempt(s)"; break; fi
    curl -sL -C - --connect-timeout 30 --speed-time 120 --speed-limit 1000 -o "$f" "$u"
    rc=$?
    if [[ $rc -eq 33 ]]; then rm -f "$f"; fi   # server refused to resume: start the file over
    sleep 5
  done
done
echo FINISHED
