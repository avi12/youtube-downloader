set -euo pipefail
cd {{WORK_DIR}}
git fetch host
git reset --hard HEAD 2>/dev/null || true
git checkout -B {{BRANCH}} host/{{BRANCH}} 2>/dev/null || git checkout -B {{BRANCH}} FETCH_HEAD
CI=true pnpm install --frozen-lockfile

# x11vnc supervisor: restart whenever Xvfb is up but x11vnc isn't running.
# set +e: ps/grep return 1 when Xvfb not yet up; must not kill the loop.
# disown: detach from bash job table so xvfb-run exit can't HUP it.
( set +e +o pipefail
  trap '' HUP
  while true; do
    XVFB_DISPLAY=$(ps -o args= -C Xvfb | awk 'NR==1{print $2}')
    XVFB_AUTH=$(ps -o args= -C Xvfb | grep -oP 'auth \K\S+' | head -1)
    if [ -n "$XVFB_DISPLAY" ] && [ -n "$XVFB_AUTH" ] && ! pgrep -x x11vnc >/dev/null 2>&1; then
      x11vnc -display "$XVFB_DISPLAY" -auth "$XVFB_AUTH" \
        -rfbport {{VNC_PORT}} -listen 0.0.0.0 -nopw -forever -shared \
        -o /tmp/x11vnc.log 2>&1
    fi
    sleep 2
  done ) &
disown $!

pkill -f "[c]hrome-linux64" 2>/dev/null || true
sleep 1

echo 'Launching dev-server under xvfb-run...'
exec xvfb-run -a pnpm dev </dev/null
