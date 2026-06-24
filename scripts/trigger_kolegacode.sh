#!/bin/bash
# Trigger KolegaCode by sending a prompt to its controlling terminal.
# This wakes up KolegaCode exactly like OpenClaw's heartbeat wakes up agents —
# programmatically, without a human typing.

KOLEGA_PID=$(pgrep -f "kolega-code" | head -1)
if [ -z "$KOLEGA_PID" ]; then
  echo "KolegaCode not running"
  exit 1
fi

TTY=$(ps -o tty= -p $KOLEGA_PID | head -1 | tr -d ' ')
if [ -z "$TTY" ]; then
  echo "Cannot find KolegaCode terminal"
  exit 1
fi

PROMPT="${1:-Check Katra shared memory for autonomous tasks assigned to you. Execute any pending tasks and report results.}"

# Write the prompt + newline to submit it
printf "%s\n" "$PROMPT" > "/dev/$TTY" 2>/dev/null && echo "Sent prompt to KolegaCode (PID $KOLEGA_PID, TTY $TTY)" && exit 0

# Fallback: try the /dev/ttys approach  
TTY_NUM=$(echo "$TTY" | sed 's/ttys0*//')
printf "%s\n" "$PROMPT" > "/dev/ttys$TTY_NUM" 2>/dev/null && echo "Sent prompt via ttys$TTY_NUM" && exit 0

echo "Failed to send prompt"
exit 1
