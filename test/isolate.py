# What a test's amarchy sees of this machine: none of its automations.
#
# A test gives amarchy a home of its own, but systemctl --user is still this
# machine's user manager: its timers would be the test's, and one that
# failed (a job of another project's) marks the Ⓐ on every test board, so
# the phone's board and the computer's differ and every chat's checks
# before a ship fail. Each test's app server calls timers(am) once it has
# loaded bin/amarchy: the automations it lists are the test's own, none
# unless named in AMARCHY_TEST_TIMERS (timer ids, a comma between).
# test/automations-view.js lists your real ones on purpose (only read), and
# doesn't call it.

import json
import os
import subprocess


def timers(am):
    real = am.systemctl_user
    keep = {t for t in os.environ.get("AMARCHY_TEST_TIMERS", "").split(",") if t}

    def systemctl_user(*args):
        r = real(*args)
        if args and args[0] in ("list-timers", "list-unit-files"):
            key = "unit" if args[0] == "list-timers" else "unit_file"
            try:
                rows = [u for u in json.loads(r.stdout or "[]") if u.get(key) in keep]
            except (ValueError, AttributeError, TypeError):
                rows = []
            r = subprocess.CompletedProcess(r.args, 0, json.dumps(rows), "")
        return r

    am.systemctl_user = systemctl_user
