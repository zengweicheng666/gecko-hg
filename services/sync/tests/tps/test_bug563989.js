/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

/*
 * The list of phases mapped to their corresponding profiles.  The object
 * here must be in strict JSON format, as it will get parsed by the Python
 * testrunner (no single quotes, extra comma's, etc).
 */

var phases = { "phase1": "profile1",
               "phase2": "profile2",
               "phase3": "profile1",
               "phase4": "profile2" };

/*
 * Bookmark asset lists: these define bookmarks that are used during the test
 */

// the initial list of bookmarks to add to the browser
var bookmarks_initial = {
  "menu": [
    { uri: "http://www.google.com",
      loadInSidebar: true,
      tags: [ "google", "computers", "internet", "www" ]
    },
    { uri: "http://bugzilla.mozilla.org/show_bug.cgi?id=%s",
      title: "Bugzilla",
      keyword: "bz"
    },
    { folder: "foldera" },
    { uri: "http://www.mozilla.com" },
    { separator: true },
    { folder: "folderb" }
  ],
  "menu/foldera": [
    { uri: "http://www.yahoo.com",
      title: "testing Yahoo"
    },
    { uri: "http://www.cnn.com",
      description: "This is a description of the site a at www.cnn.com"
    },
    { livemark: "Livemark1",
      feedUri: "http://rss.wunderground.com/blog/JeffMasters/rss.xml",
      siteUri: "http://www.wunderground.com/blog/JeffMasters/show.html"
    }
  ],
  "menu/folderb": [
    { uri: "http://www.apple.com",
      tags: [ "apple", "mac" ]
    }
  ],
  "toolbar": [
    { uri: "place:queryType=0&sort=8&maxResults=10&beginTimeRef=1&beginTime=0",
      title: "Visited Today"
    }
  ]
};

// a list of bookmarks to delete during a 'delete' action
var bookmarks_to_delete = {
  "menu/folderb": [
    { uri: "http://www.apple.com",
      tags: [ "apple", "mac" ]
    }
  ],
  "toolbar": [
    { uri: "place:queryType=0&sort=8&maxResults=10&beginTimeRef=1&beginTime=0",
      title: "Visited Today"
    }
  ]
};

/*
 * Test phases
 */

// Add bookmarks to profile1 and sync.
Phase('phase1', [
  [Bookmarks.add, bookmarks_initial],
  [Bookmarks.verify, bookmarks_initial],
  [Sync],
]);

// Sync to profile2 and verify that the bookmarks are present.  Delete 
// some bookmarks, and verify that they're not present, but don't sync again.
Phase('phase2', [
  [Sync],
  [Bookmarks.verify, bookmarks_initial],
  [Bookmarks.delete, bookmarks_to_delete],
  [Bookmarks.verifyNot, bookmarks_to_delete]
]);

// Using profile1, sync again with wipe-server set to true.  Verify our
// initial bookmarks are still all present.
Phase('phase3', [
  [Sync, SYNC_WIPE_REMOTE],
  [Bookmarks.verify, bookmarks_initial]
]);

// Back in profile2, do a sync and verify that the bookmarks we had
// deleted earlier are now restored.
Phase('phase4', [
  [Sync],
  [Bookmarks.verify, bookmarks_initial]
]);
