# amarchy

## How to work here

- **No shortcuts: always build the most complete, highest-quality solution.** With AI doing the coding, thoroughness is cheap, so it is the rule rather than the exception. Fix the root cause and every related gap you find (races, failure paths, recovery, install/uninstall, docs), not just the symptom that was reported, and verify the result on the real desktop before calling it done.
- **"Ship it" means: get it on GitHub and leave the local `main` identical to it.** Commit the work on the session's branch, merge it into `main` in the main checkout (`~/Work/amarchy`), push `main` to `origin`, and pull there so local `main` and `origin/main` are the same commit. The installed amarchy runs from that checkout, so finish with its `install.sh` and `omarchy-restart-shell`, and say what landed.
