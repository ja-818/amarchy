# amarchy

## How to work here

- **No shortcuts: always build the most complete, highest-quality solution.** With AI doing the coding, thoroughness is cheap, so it is the rule rather than the exception. Fix the root cause and every related gap you find (races, failure paths, recovery, install/uninstall, docs), not just the symptom that was reported, and verify the result in the real app (on the phone and in a browser) before calling it done.
- **"Ship it" means: get it on GitHub and leave the local `main` identical to it.** Commit the work on the session's branch, merge it into `main` in the main checkout (`$AMARCHY_ROOT`, e.g. `~/Work/amarchy`), push `main` to `origin`, and pull there so local `main` and `origin/main` are the same commit. The installed amarchy runs from that checkout, so finish with its `install.sh` and `systemctl --user restart amarchy-app`, and say what landed.
- **After shipping, say whether the session can be closed.** The user has many sessions open and can't tell which are finished. When a ship leaves nothing open in this session (no uncommitted work, no pending question, nothing left to do), end the message with a line of `====` and then "Everything done, you can close this session." (`Ctrl+Alt+X`). If something is still open, say what instead. If the user asks you to close it, run `amarchy close` yourself once the ship is done.
