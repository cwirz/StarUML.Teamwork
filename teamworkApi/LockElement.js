/**
 * Copyright (c) 2016 Michael Seiler. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the "Software"), to deal in the Software without restriction, including without
 * limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software,
 * and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
 * THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
 * TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 */
define(function (require, exports, module) {
    "use strict";

    //Modules
    var PreferenceManager 	= app.getModule("core/PreferenceManager");
    var Toast 				= app.getModule("ui/Toast");
    var Repository      	= app.getModule("core/Repository");
    var ProjectManager  	= app.getModule("engine/ProjectManager");
    var Async  	            = app.getModule("utils/Async");
    var Dialogs             = app.getModule('dialogs/Dialogs');
    var FileSystem          = app.getModule("filesystem/FileSystem");
    var ModelExplorerView   = app.getModule("explorer/ModelExplorerView");

    //Imports
    var TeamworkBase        = require("./TeamworkBase");
    var GitConfiguration    = require("../preferences/TeamworkConfiguration");
    var GitApi              = require("../StarGit/api-built");
    var ProgressDialog      = require("../dialogs/ProgressDialog");
    var TeamworkView        = require("../teamworkView/TeamworkView");
    var ElementLocker       = require("../locking/ElementLocker");

    //Constants

    //Variables

    //Functions

    function lockWholeProject() {
        Toast.error("Not implemented yet");
        throw Error("Not implemented");
    }

    function lockGivenElements(elements) {
        var workingPath = GitConfiguration.getLocalWorkingDirectory();
        var projectName = TeamworkBase.getTeamworkProjectName();
        elements.forEach(function (element, index, array) {
            var elementID = element.escapedID;
            var unescapedElementId = element.elementID;
            var elementWorkingPath = workingPath + "/locking/" + projectName + "/" + elementID;
            var refContent = 'refs/heads/locks/' + projectName + '/' + elementID;
            var valueToResolve = 'locks/' + projectName + '/' + elementID;

            var directory = FileSystem.getDirectoryForPath(workingPath + "/locking/");
            directory.unlink();
            directory.create();
            directory = FileSystem.getDirectoryForPath(workingPath + "/locking/" + projectName);
            directory.unlink();
            directory.create();

            var prepareWorkingDirPromise = TeamworkBase.prepareWorkingDirectory(valueToResolve, elementWorkingPath, refContent);
            var branchPromise = TeamworkBase.createAndCheckoutBranch(prepareWorkingDirPromise, projectName);
            var lockInfoPromise = createAndAddLockingInformation(branchPromise, elementWorkingPath, unescapedElementId);
            var pushPromise = pushLockingInformationToServer(lockInfoPromise);
            rebuildWorkspaceAndProjectInfo(pushPromise);
        });
    }

    function unlockGivenElements(elements) {
        var workingPath = GitConfiguration.getLocalWorkingDirectory();
        var projectName = TeamworkBase.getTeamworkProjectName();
        for(var key in elements) {
            if(elements.hasOwnProperty(key)) {
                var element = elements[key];
                var branchName = element;
                var elementWorkingPath = workingPath + "/locking/" + projectName + "/" + branchName;
                var refContent = 'refs/heads/locks/' + projectName + '/' + branchName;
                var valueToResolve = 'locks/' + projectName + '/' + branchName;
                var prepareWorkingDirPromise = TeamworkBase.prepareWorkingDirectory(valueToResolve, elementWorkingPath, refContent);
                var branchPromise = TeamworkBase.createAndCheckoutBranch(prepareWorkingDirPromise, projectName);
                removeLockLocallyAndFromServer(branchPromise, element);
            }
        }
    }

    function createAndAddLockingInformation(promise, elementWorkingPath, unescapedElementId) {
        var nextPromise = $.Deferred();
        promise.done(function(workingDir) {
            var file = FileSystem.getFileForPath(elementWorkingPath + "/lockedBy.json");
            var value = {
                lockedBy: GitConfiguration.getUsername(),
                elementID: unescapedElementId,
                lockingDate: new Date().toJSON().slice(0,19).replace("T", " ")
            };
            file.write(JSON.stringify(value), function() {
                var options = {
                    dir: workingDir,
                    name: GitConfiguration.getUsername(),
                    email: GitConfiguration.getUsername() + '@noreply.com',
                    commitMsg: 'Locking Element: ' + unescapedElementId
                };
                GitApi.commit(options, function() {
                    nextPromise.resolve(value, workingDir);
                },
                function (error) {
                    TeamworkBase.handleGitApiError(workingDir, error)
                });
            });
        });
        return nextPromise;
    }

    function pushLockingInformationToServer(promise) {
        var nextPromise = $.Deferred();
        promise.done(function(value, workingDir) {
            var options = {
                dir: workingDir,
                url: GitConfiguration.getRemoteURL(),
                username: GitConfiguration.getUsername(),
                password: GitConfiguration.getPassword(),
                progress: ProgressDialog.showProgress("Locking Element...", "Connecting to server...")
            };
            GitApi.push(options, function() {
                nextPromise.resolve(value, workingDir);
            });
        });
        return nextPromise;
    }

    function rebuildWorkspaceAndProjectInfo(promise) {
        promise.done(function(value, workingDir) {
            Toast.info("Element locked...");
            Dialogs.cancelModalDialogIfOpen('modal');
            workingDir = FileSystem.getDirectoryForPath(workingDir.fullPath);
            workingDir.unlink();
            TeamworkView.addElementLockedEvent(value.elementID, value.lockingDate, value.lockedBy);
        });
    }

    function removeLockLocallyAndFromServer(promise, element) {
        promise.done(function(workingDir) {
            var options = {
                dir: workingDir,
                url: GitConfiguration.getRemoteURL(),
                remove: true,
                username: GitConfiguration.getUsername(),
                password: GitConfiguration.getPassword(),
                progress: ProgressDialog.showProgress("Unlocking Element...", "Connecting to server...")
            };
            GitApi.push(options, function() {
                Toast.info("Element unlocked...");
                Dialogs.cancelModalDialogIfOpen('modal');
                workingDir = FileSystem.getDirectoryForPath(workingDir.fullPath);
                workingDir.unlink();
                TeamworkView.addElementUnlockedEvent(element, GitConfiguration.getUsername());
            });
        });
    }

    function updateLockInfo() {
        var localPath = GitConfiguration.getLocalWorkingDirectory();
        var projectName = TeamworkBase.getTeamworkProjectName();

        TeamworkBase.getProjectsRootDir(localPath, function(workingDir) {
            var directory = FileSystem.getDirectoryForPath(workingDir.fullPath);
            directory.unlink();
            directory.create();
            var options = {
                dir: workingDir,
                url: GitConfiguration.getRemoteURL(),
                username: GitConfiguration.getUsername(),
                password: GitConfiguration.getPassword(),
                projectName: TeamworkBase.getTeamworkProjectName()
            }
            GitApi.getProjectLockRefs(options, function(locks) {
                executeUpdateLockInfo(locks, projectName);
            });
        });
    }

    function executeUpdateLockInfo(locks, projectName) {
        locks.forEach(function(lockInfo, index, array) {
            var lockInfoPromise = loadLockInfoFromServer(lockInfo.name, projectName);
            updateElementLockInfo(lockInfoPromise);
        });
    }

    function loadLockInfoFromServer(lockName, projectName) {
        var promise = new $.Deferred();
        var localPath = GitConfiguration.getLocalWorkingDirectory();
        var locksPath = localPath + "/locking/" + projectName + "/" + lockName;

        var directory = FileSystem.getDirectoryForPath(localPath + "/locking/");
        directory.unlink();
        directory.create();
        directory = FileSystem.getDirectoryForPath(localPath + "/locking/" + projectName);
        directory.unlink();
        directory.create();

        TeamworkBase.getProjectsRootDir(locksPath, function(workingDir) {
            var branchName = 'locks/' + projectName + '/' + lockName;
            var progressCallback = ProgressDialog.showProgress("Loading Teamwork-Project-Locks...", "Connecting to server...");
            var options = TeamworkBase.getDefaultGitOptions(workingDir, branchName, progressCallback, projectName);
            GitApi.clone(options, function () {
                promise.resolve(workingDir);
            },
            function (err) {
                TeamworkBase.handleGitApiError(workingDir, err);
            });
        });
        return promise;
    }

    function updateElementLockInfo(promise) {
        promise.done(function(workingDir) {
            var lockInfoFile = FileSystem.getFileForPath(workingDir.fullPath + "/lockedBy.json");
            lockInfoFile.read(function(err, data, stat) {
                lockInfoFile = JSON.parse(data);
                var lockedElement = Repository.get(lockInfoFile.elementID);
                if(lockedElement) {
                    lockedElement.lockElement(lockInfoFile.lockedBy);
                    ElementLocker.addLockedElement(lockedElement);
                    ModelExplorerView.update(lockedElement);
                    TeamworkView.addUpdateLockInfoEvent(lockInfoFile.elementID, lockInfoFile.lockingDate, lockInfoFile.lockedBy);
                } else {
                    var message = "There exists a lock on the Server for an Element that does not exist. Please contact the Server-Administrator to handle the problem. Element-ID: " + lockInfoFile.elementID;
                    TeamworkView.addTeamworkItem("Error", message, lockInfoFile.lockingDate, lockInfoFile.lockedBy);
                }
                Dialogs.cancelModalDialogIfOpen('modal');
            });
        });
    }

    //Backend
    exports.lockWholeTeamworkProject = lockWholeProject;
    exports.updateProjectLockInfo = updateLockInfo;
    exports.lockGivenElements = lockGivenElements;
    exports.unlockGivenElements = unlockGivenElements;
});