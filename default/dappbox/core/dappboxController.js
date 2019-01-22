angular.module('dappbox.core')
    .config(function($locationProvider) {
        $locationProvider.html5Mode({enabled: true, requireBase: false}).hashPrefix('!');
    })
    .controller('DappBoxController', function ($scope, $http, $location, LocaleService, Events, $filter) {
        'use strict';

        // private/helper definitions

        var prevDate = 0;
        var navigatingAway = false;
        var online = false;
        var restarting = false;

        function initController() {
            LocaleService.autoConfigLocale();
            setInterval($scope.refresh, 20000);
            setInterval($scope.refreshPieGraphData, 31000);
            setInterval($scope.refreshTableData, 31000);
            setInterval($scope.refreshFolderData, 6000);
            Events.start();
        }

        // public/scope definitions

        $scope.completion = {};
        $scope.config = {};
        $scope.configInSync = true;
        $scope.connections = {};
        $scope.errors = [];
        $scope.model = {};
        $scope.myID = '';
        $scope.devices = [];
        $scope.deviceRejections = {};
        $scope.discoveryCache = {};
        $scope.folderRejections = {};
        $scope.protocolChanged = false;
        $scope.reportData = {};
        $scope.reportPreview = false;
        $scope.folders = {};
        $scope.seenError = '';
        $scope.upgradeInfo = null;
        $scope.deviceStats = {};
        $scope.folderStats = {};
        $scope.progress = {};
        $scope.version = {};
        $scope.needed = [];
        $scope.neededTotal = 0;
        $scope.neededCurrentPage = 1;
        $scope.neededPageSize = 10;
        $scope.failed = {};
        $scope.failedCurrentPage = 1;
        $scope.failedCurrentFolder = undefined;
        $scope.failedPageSize = 10;
        $scope.scanProgress = {};
        $scope.themes = [];
        $scope.globalChangeEvents = {};
        $scope.metricRates = false;
        $scope.folderPathErrors = {};
        $scope.visibleFolder = {};
        $scope.visible = false;
        $scope.graphdata = [];
        $scope.pieGraph = true;
        $scope.diskStUsage = 0;
        $scope.tableData = {};
        $scope.folderData = {};
        $scope.qrRaw = {};
        $scope.qrRawID = {};
        $scope.addName = '';
        $scope.editName = '';
        $scope.catName = '';
        $scope.shareCat = true;
        $scope.itemSharedFile     = "";
        $scope.itemHashSharedFile = "";
        $scope.nodeIDSharedFile   = "";
        $scope.nodeHashSharedFile = "";
        $scope.timeSharedFile     = "";
        $scope.stateSharedFile    = "";
        $scope.ethAddressAccount = "";
        $scope.ethAddressNode = "";
        $scope.timedata = [];
        $scope.ethereumnodeinfo = [];


        try {
            $scope.metricRates = (window.localStorage["metricRates"] == "true");
        } catch (exception) { }

        $scope.folderDefaults = {
            selectedDevices: {},
            selectedCategories: "",
            type: "readwrite",
            rescanIntervalS: 60,
            minDiskFree: {value: 1, unit: "%"},
            maxConflicts: 10,
            fsync: true,
            order: "random",
            fileVersioningSelector: "none",
            trashcanClean: 0,
            simpleKeep: 5,
            staggeredMaxAge: 365,
            staggeredCleanInterval: 3600,
            staggeredVersionsPath: "",
            externalCommand: "",
            autoNormalize: true
        };

        $scope.localStateTotal = {
            bytes: 0,
            directories: 0,
            files: 0
        };

        $(window).bind('beforeunload', function () {
            navigatingAway = true;
        });

        $scope.$on("$locationChangeSuccess", function () {
            LocaleService.useLocale($location.search().lang);
        });

        $scope.needActions = {
            'rm': 'Del',
            'rmdir': 'Del (dir)',
            'sync': 'Sync',
            'touch': 'Update'
        };
        $scope.needIcons = {
            'rm': 'trash-o',
            'rmdir': 'trash-o',
            'sync': 'arrow-circle-o-down',
            'touch': 'asterisk'
        };

        $scope.$on(Events.ONLINE, function () {
            if (online && !restarting) {
                return;
            }

            console.log('UIOnline');

            refreshSystem();
            refreshDiscoveryCache();
            refreshConfig();
            refreshConnectionStats();
            graphic();
            pieData();
            ethereumInfo();
            refreshDeviceStats();
            refreshFolderStats();
            tableData();
            folderData();
            refreshGlobalChanges();


            $http.get(urlbase + '/system/version').success(function (data) {
                if ($scope.version.version && $scope.version.version !== data.version) {
                    // We already have a version response, but it differs from
                    // the new one. Reload the full GUI in case it's changed.
                    document.location.reload(true);
                }

                $scope.version = data;
                $scope.version.isDevelopmentVersion = data.version.indexOf('-')>0;
            }).error($scope.emitHTTPError);

            $http.get(urlbase + '/svc/report').success(function (data) {
                $scope.reportData = data;
            }).error($scope.emitHTTPError);

            // $http.get(urlbase + '/system/upgrade').success(function (data) {
            //     $scope.upgradeInfo = data;
            // }).error(function () {
            //     $scope.upgradeInfo = null;
            // });

            online = true;
            restarting = false;
            $('#networkError').modal('hide');
            $('#restarting').modal('hide');
            $('#shutdown').modal('hide');
        });

        $scope.$on(Events.OFFLINE, function () {
            if (navigatingAway || !online) {
                return;
            }

            console.log('UIOffline');
            online = false;
            if (!restarting) {
                $('#networkError').modal();
            }
        });

        $scope.$on('HTTPError', function (event, arg) {
            // Emitted when a HTTP call fails. We use the status code to try
            // to figure out what's wrong.

            if (navigatingAway || !online) {
                return;
            }

            console.log('HTTPError', arg);
            online = false;
            if (!restarting) {
                if (arg.status === 0) {
                    // A network error, not an HTTP error
                    $scope.$emit(Events.OFFLINE);
                } else if (arg.status >= 400 && arg.status <= 599) {
                    // A genuine HTTP error
                    $('#networkError').modal('hide');
                    $('#restarting').modal('hide');
                    $('#shutdown').modal('hide');
                    $('#httpError').modal();
                }
            }
        });

        $scope.$on(Events.STATE_CHANGED, function (event, arg) {
            var data = arg.data;
            if ($scope.model[data.folder]) {
                $scope.model[data.folder].state = data.to;
                $scope.model[data.folder].error = data.error;

                // If a folder has started syncing, then any old list of
                // errors is obsolete. We may get a new list of errors very
                // shortly though.
                if (data.to === 'syncing') {
                    $scope.failed[data.folder] = [];
                }

                // If a folder has started scanning, then any scan progress is
                // also obsolete.
                if (data.to === 'scanning') {
                    delete $scope.scanProgress[data.folder];
                }

                // If a folder finished scanning, then refresh folder stats
                // to update last scan time.
                if(data.from === 'scanning' && data.to === 'idle') {
                    refreshFolderStats();
                }
            }
        });

        $scope.$on(Events.LOCAL_INDEX_UPDATED, function (event, arg) {
            refreshFolderStats();
            refreshGlobalChanges();
        });

        $scope.$on(Events.DEVICE_DISCONNECTED, function (event, arg) {
            $scope.connections[arg.data.id].connected = false;
            refreshDeviceStats();
        });

        $scope.$on(Events.DEVICE_CONNECTED, function (event, arg) {
            if (!$scope.connections[arg.data.id]) {
                $scope.connections[arg.data.id] = {
                    inbps: 0,
                    outbps: 0,
                    inBytesTotal: 0,
                    outBytesTotal: 0,
                    type: arg.data.type,
                    address: arg.data.addr
                };
                $scope.completion[arg.data.id] = {
                    _total: 100
                };
            }
        });

        $scope.$on('ConfigLoaded', function () {
            if ($scope.config.options.urAccepted === 0) {
                // If usage reporting has been neither accepted nor declined,
                // we want to ask the user to make a choice. But we don't want
                // to bug them during initial setup, so we set a cookie with
                // the time of the first visit. When that cookie is present
                // and the time is more than four hours ago, we ask the
                // question.

                var firstVisit = document.cookie.replace(/(?:(?:^|.*;\s*)firstVisit\s*\=\s*([^;]*).*$)|^.*$/, "$1");
                if (!firstVisit) {
                    document.cookie = "firstVisit=" + Date.now() + ";max-age=" + 30 * 24 * 3600;
                } else {
                    if (+firstVisit < Date.now() - 4 * 3600 * 1000) {
                        $('#ur').modal();
                    }
                }
            }
        });

        $scope.$on(Events.DEVICE_REJECTED, function (event, arg) {
            $scope.deviceRejections[arg.data.device] = arg;
        });

        $scope.$on(Events.FOLDER_REJECTED, function (event, arg) {
            $scope.folderRejections[arg.data.folder + "-" + arg.data.device] = arg;
        });

        $scope.$on(Events.CONFIG_SAVED, function (event, arg) {
            updateLocalConfig(arg.data);

            $http.get(urlbase + '/system/config/insync').success(function (data) {
                $scope.configInSync = data.configInSync;
            }).error($scope.emitHTTPError);
        });

        $scope.$on(Events.DOWNLOAD_PROGRESS, function (event, arg) {
            var stats = arg.data;
            var progress = {};
            for (var folder in stats) {
                progress[folder] = {};
                for (var file in stats[folder]) {
                    var s = stats[folder][file];
                    var reused = 100 * s.reused / s.total;
                    var copiedFromOrigin = 100 * s.copiedFromOrigin / s.total;
                    var copiedFromElsewhere = 100 * s.copiedFromElsewhere / s.total;
                    var pulled = 100 * s.pulled / s.total;
                    var pulling = 100 * s.pulling / s.total;
                    // We try to round up pulling to at least a percent so that it would be at least a bit visible.
                    if (pulling < 1 && pulled + copiedFromElsewhere + copiedFromOrigin + reused <= 99) {
                        pulling = 1;
                    }
                    progress[folder][file] = {
                        reused: reused,
                        copiedFromOrigin: copiedFromOrigin,
                        copiedFromElsewhere: copiedFromElsewhere,
                        pulled: pulled,
                        pulling: pulling,
                        bytesTotal: s.bytesTotal,
                        bytesDone: s.bytesDone,
                    };
                }
            }
            for (var folder in $scope.progress) {
                if (!(folder in progress)) {
                    if ($scope.neededFolder === folder) {
                        refreshNeed(folder);
                    }
                } else if ($scope.neededFolder === folder) {
                    for (file in $scope.progress[folder]) {
                        if (!(file in progress[folder])) {
                            refreshNeed(folder);
                            break;
                        }
                    }
                }
            }
            $scope.progress = progress;
            console.log("DownloadProgress", $scope.progress);
        });

        $scope.$on(Events.FOLDER_SUMMARY, function (event, arg) {
            var data = arg.data;
            $scope.model[data.folder] = data.summary;
            recalcLocalStateTotal();
        });

        $scope.$on(Events.FOLDER_COMPLETION, function (event, arg) {
            var data = arg.data;
            if (!$scope.completion[data.device]) {
                $scope.completion[data.device] = {};
            }
            $scope.completion[data.device][data.folder] = data;
            recalcCompletion(data.device);
        });

        $scope.$on(Events.FOLDER_ERRORS, function (event, arg) {
            var data = arg.data;
            $scope.failed[data.folder] = data.errors;
        });

        $scope.$on(Events.FOLDER_SCAN_PROGRESS, function (event, arg) {
            var data = arg.data;
            $scope.scanProgress[data.folder] = {
                current: data.current,
                total: data.total,
                rate: data.rate
            };
            console.log("FolderScanProgress", data);
        });

        $scope.emitHTTPError = function (data, status, headers, config) {
            $scope.$emit('HTTPError', {data: data, status: status, headers: headers, config: config});
        };

        var debouncedFuncs = {};

        function refreshFolder(folder) {
            var key = "refreshFolder" + folder;
            if (!debouncedFuncs[key]) {
                debouncedFuncs[key] = debounce(function () {
                    $http.get(urlbase + '/db/status?folder=' + encodeURIComponent(folder)).success(function (data) {
                        $scope.model[folder] = data;
                        recalcLocalStateTotal();
                        console.log("refreshFolder", folder, data);
                    }).error($scope.emitHTTPError);
                }, 1000, true);
            }
            debouncedFuncs[key]();
        }

        function updateLocalConfig(config) {
            var hasConfig = !isEmptyObject($scope.config);

            $scope.config = config;
            $scope.config.options._listenAddressesStr = $scope.config.options.listenAddresses.join(', ');
            $scope.config.options._globalAnnounceServersStr = $scope.config.options.globalAnnounceServers.join(', ');

            if ($scope.config.categories == null){
              $scope.categories = [{Name: "Default", SubCategories: ["None"]}];
            } else {
              $scope.categories = $scope.config.categories;
            }

            $scope.devices = $scope.config.devices;
            $scope.devices.forEach(function (deviceCfg) {
                $scope.completion[deviceCfg.deviceID] = {
                    _total: 100
                };
            });
            $scope.devices.sort(deviceCompare);

            $scope.folders = folderMap($scope.config.folders);
            Object.keys($scope.folders).forEach(function (folder) {
                refreshFolder(folder);
                $scope.folders[folder].devices.forEach(function (deviceCfg) {
                    refreshCompletion(deviceCfg.deviceID, folder);
                });
            });

            // If we're not listening on localhost, and there is no
            // authentication configured, and the magic setting to silence the
            // warning isn't set, then yell at the user.
            var guiCfg = $scope.config.gui;
            $scope.openNoAuth = guiCfg.address.substr(0, 4) !== "127."
                && guiCfg.address.substr(0, 6) !== "[::1]:"
                && (!guiCfg.user || !guiCfg.password)
                && !guiCfg.insecureAdminAccess;

            if (!hasConfig) {
                $scope.$emit('ConfigLoaded');
            }
        }

        function refreshSystem() {
          if ($scope.visible == true){
            for (var i = 0; i < $scope.visibleFolder.length; i++) {
              $('#'+$scope.visibleFolder[i]).show();
            }
            $scope.visible = false;
          }
            $http.get(urlbase + '/system/status').success(function (data) {
                $scope.myID = data.myID;
                $scope.system = data;

                var listenersFailed = [];
                for (var address in data.connectionServiceStatus) {
                    if (data.connectionServiceStatus[address].error) {
                        listenersFailed.push(address + ": " + data.connectionServiceStatus[address].error);
                    }
                }
                $scope.listenersFailed = listenersFailed;
                $scope.listenersTotal = Object.keys(data.connectionServiceStatus).length;

                $scope.discoveryTotal = data.discoveryMethods;
                var discoveryFailed = [];
                for (var disco in data.discoveryErrors) {
                    if (data.discoveryErrors[disco]) {
                        discoveryFailed.push(disco + ": " + data.discoveryErrors[disco]);
                    }
                }
                $scope.discoveryFailed = discoveryFailed;
                console.log("refreshSystem", data);
            }).error($scope.emitHTTPError);
        }

        function refreshDiscoveryCache() {

          if ($scope.visible == true){
            for (var i = 0; i < $scope.visibleFolder.length; i++) {
              $('#'+$scope.visibleFolder[i]).show();
            }
            $scope.visible = false;
          }

            $http.get(urlbase + '/system/discovery').success(function (data) {
                for (var device in data) {
                    for (var i = 0; i < data[device].addresses.length; i++) {
                        // Relay addresses are URLs with
                        // .../?foo=barlongstuff that we strip away here. We
                        // remove the final slash as well for symmetry with
                        // tcp://192.0.2.42:1234 type addresses.
                        data[device].addresses[i] = data[device].addresses[i].replace(/\/\?.*/, '');
                    }
                }
                $scope.discoveryCache = data;
                console.log("refreshDiscoveryCache", data);
            }).error($scope.emitHTTPError);
        }

        function recalcLocalStateTotal () {
            $scope.localStateTotal = {
                bytes: 0,
                directories: 0,
                files: 0
            };

            for (var f in $scope.model) {
               $scope.localStateTotal.bytes += $scope.model[f].localBytes;
               $scope.localStateTotal.files += $scope.model[f].localFiles;
               $scope.localStateTotal.directories += $scope.model[f].localDirectories;
            }
        }

        function recalcCompletion(device) {
            var total = 0, needed = 0, deletes = 0;
            for (var folder in $scope.completion[device]) {
                if (folder === "_total") {
                    continue;
                }
                total += $scope.completion[device][folder].globalBytes;
                needed += $scope.completion[device][folder].needBytes;
                deletes += $scope.completion[device][folder].needDeletes;
            }
            if (total == 0) {
                $scope.completion[device]._total = 100;
            } else {
                $scope.completion[device]._total = 100 * (1 - needed / total);
            }

            if (needed == 0 && deletes > 0) {
                // We don't need any data, but we have deletes that we need
                // to do. Drop down the completion percentage to indicate
                // that we have stuff to do.
                $scope.completion[device]._total = 95;
            }
            console.log("recalcCompletion", device, $scope.completion[device]);
        }

        function refreshCompletion(device, folder) {
            if (device === $scope.myID) {
                return;
            }

            $http.get(urlbase + '/db/completion?device=' + device + '&folder=' + encodeURIComponent(folder)).success(function (data) {
                if (!$scope.completion[device]) {
                    $scope.completion[device] = {};
                }
                $scope.completion[device][folder] = data;
                recalcCompletion(device);
            }).error($scope.emitHTTPError);
        }

        function refreshConnectionStats() {
            if ($scope.visible == true){
              for (var i = 0; i < $scope.visibleFolder.length; i++) {
                $('#'+$scope.visibleFolder[i]).show();
              }
              $scope.visible = false;
            }
            $http.get(urlbase + '/system/connections').success(function (data) {
                var now = Date.now(),
                    td = (now - prevDate) / 1000,
                    id;

                prevDate = now;

                try {
                    data.total.inbps = Math.max(0, (data.total.inBytesTotal - $scope.connectionsTotal.inBytesTotal) / td);
                    data.total.outbps = Math.max(0, (data.total.outBytesTotal - $scope.connectionsTotal.outBytesTotal) / td);
                } catch (e) {
                    data.total.inbps = 0;
                    data.total.outbps = 0;
                }
                $scope.connectionsTotal = data.total;

                data = data.connections;
                for (id in data) {
                    if (!data.hasOwnProperty(id)) {
                        continue;
                    }
                    try {
                        data[id].inbps = Math.max(0, (data[id].inBytesTotal - $scope.connections[id].inBytesTotal) / td);
                        data[id].outbps = Math.max(0, (data[id].outBytesTotal - $scope.connections[id].outBytesTotal) / td);
                    } catch (e) {
                        data[id].inbps = 0;
                        data[id].outbps = 0;
                    }
                }
                $scope.connections = data;
                console.log("refreshConnections", data);
            }).error($scope.emitHTTPError);
        }

        function refreshErrors() {
          if ($scope.visible == true){
            for (var i = 0; i < $scope.visibleFolder.length; i++) {
              $('#'+$scope.visibleFolder[i]).show();
            }
            $scope.visible = false;
          }
            $http.get(urlbase + '/system/error').success(function (data) {
                $scope.errors = data.errors;
                console.log("refreshErrors", data);
            }).error($scope.emitHTTPError);
        }

        function refreshConfig() {
            $http.get(urlbase + '/system/config').success(function (data) {
                updateLocalConfig(data);
                console.log("refreshConfig", data);
            }).error($scope.emitHTTPError);

            $http.get(urlbase + '/system/config/insync').success(function (data) {
                $scope.configInSync = data.configInSync;
            }).error($scope.emitHTTPError);
        }

        function refreshNeed(folder) {
            var url = urlbase + "/db/need?folder=" + encodeURIComponent(folder);
            url += "&page=" + $scope.neededCurrentPage;
            url += "&perpage=" + $scope.neededPageSize;
            $http.get(url).success(function (data) {
                if ($scope.neededFolder === folder) {
                    console.log("refreshNeed", folder, data);
                    parseNeeded(data);
                }
            }).error($scope.emitHTTPError);
        }

        function needAction(file) {
            var fDelete = 4096;
            var fDirectory = 16384;

            if ((file.flags & (fDelete + fDirectory)) === fDelete + fDirectory) {
                return 'rmdir';
            } else if ((file.flags & fDelete) === fDelete) {
                return 'rm';
            } else if ((file.flags & fDirectory) === fDirectory) {
                return 'touch';
            } else {
                return 'sync';
            }
        }

        function parseNeeded(data) {
            var merged = [];
            data.progress.forEach(function (item) {
                item.type = "progress";
                item.action = needAction(item);
                merged.push(item);
            });
            data.queued.forEach(function (item) {
                item.type = "queued";
                item.action = needAction(item);
                merged.push(item);
            });
            data.rest.forEach(function (item) {
                item.type = "rest";
                item.action = needAction(item);
                merged.push(item);
            });
            $scope.needed = merged;
            $scope.neededTotal = data.total;
        }

        $scope.neededPageChanged = function (page) {
            $scope.neededCurrentPage = page;
            refreshNeed($scope.neededFolder);
        };

        $scope.neededChangePageSize = function (perpage) {
            $scope.neededPageSize = perpage;
            refreshNeed($scope.neededFolder);
        };

        $scope.failedPageChanged = function (page) {
            $scope.failedCurrentPage = page;
        };

        $scope.failedChangePageSize = function (perpage) {
            $scope.failedPageSize = perpage;
        };

        var refreshDeviceStats = debounce(function () {
            $http.get(urlbase + "/stats/device").success(function (data) {
                $scope.deviceStats = data;
                for (var device in $scope.deviceStats) {
                    $scope.deviceStats[device].lastSeen = new Date($scope.deviceStats[device].lastSeen);
                    $scope.deviceStats[device].lastSeenDays = (new Date() - $scope.deviceStats[device].lastSeen) / 1000 / 86400;
                }
                console.log("refreshDeviceStats", data);
            }).error($scope.emitHTTPError);
        }, 2500);

        var refreshFolderStats = debounce(function () {
            $http.get(urlbase + "/stats/folder").success(function (data) {
                $scope.folderStats = data;
                for (var folder in $scope.folderStats) {
                    if ($scope.folderStats[folder].lastFile) {
                        $scope.folderStats[folder].lastFile.at = new Date($scope.folderStats[folder].lastFile.at);
                    }

                    $scope.folderStats[folder].lastScan = new Date($scope.folderStats[folder].lastScan);
                    $scope.folderStats[folder].lastScanDays = (new Date() - $scope.folderStats[folder].lastScan) / 1000 / 86400;
                }
                console.log("refreshfolderStats", data);
            }).error($scope.emitHTTPError);
        }, 2500);

        var refreshThemes = debounce(function () {
            $http.get("themes.json").success(function (data) { // no urlbase here as this is served by the asset handler
                $scope.themes = data.themes;
            }).error($scope.emitHTTPError);
        }, 2500);

        var refreshGlobalChanges = debounce(function () {
            $http.get(urlbase + "/events/disk?limit=25").success(function (data) {
                data = data.reverse();
                $scope.globalChangeEvents = data;

                console.log("refreshGlobalChanges", data);
            }).error($scope.emitHTTPError);
        }, 2500);

        $scope.refresh = function () {
            refreshSystem();
            refreshDiscoveryCache();
            refreshConnectionStats();
            refreshErrors();
        };

        $scope.folderStatus = function (folderCfg) {
            if (typeof $scope.model[folderCfg.id] === 'undefined') {
                return 'unknown';
            }

            if (folderCfg.paused) {
                return 'paused';
            }

            // after restart dappbox process state may be empty
            if (!$scope.model[folderCfg.id].state) {
                return 'unknown';
            }

            if ($scope.model[folderCfg.id].invalid) {
                return 'stopped';
            }

            var state = '' + $scope.model[folderCfg.id].state;
            if (state === 'error') {
                return 'stopped'; // legacy, the state is called "stopped" in the GUI
            }
            if (state === 'idle' && $scope.neededItems(folderCfg.id) > 0) {
                return 'outofsync';
            }
            if (state === 'scanning') {
                return state;
            }

            if (folderCfg.devices.length <= 1) {
                return 'unshared';
            }

            return state;
        };

        $scope.folderClass = function (folderCfg) {
            var status = $scope.folderStatus(folderCfg);

            if (status === 'idle') {
                return 'success';
            }
            if (status == 'paused') {
                return 'default';
            }
            if (status === 'syncing' || status === 'scanning') {
                return 'primary';
            }
            if (status === 'unknown') {
                return 'info';
            }
            if (status === 'stopped' || status === 'outofsync' || status === 'error') {
                return 'danger';
            }
            if (status === 'unshared') {
                return 'warning';
            }

            return 'info';
        };

        $scope.neededItems = function (folderID) {
            if (!$scope.model[folderID]) {
                return 0
            }

            return $scope.model[folderID].needFiles + $scope.model[folderID].needDirectories +
                $scope.model[folderID].needSymlinks + $scope.model[folderID].needDeletes;
        };

        $scope.syncPercentage = function (folder) {
            if (typeof $scope.model[folder] === 'undefined') {
                return 100;
            }
            if ($scope.model[folder].globalBytes === 0) {
                return 100;
            }

            var pct = 100 * $scope.model[folder].inSyncBytes / $scope.model[folder].globalBytes;
            return Math.floor(pct);
        };

        $scope.syncRemaining = function (folder) {
            // Remaining sync bytes
            if (typeof $scope.model[folder] === 'undefined') {
                return 0;
            }
            if ($scope.model[folder].globalBytes === 0) {
                return 0;
            }

            var bytes = $scope.model[folder].globalBytes - $scope.model[folder].inSyncBytes;
            if (isNaN(bytes) || bytes < 0) {
                return 0;
            }
            return bytes;
        };

        $scope.scanPercentage = function (folder) {
            if (!$scope.scanProgress[folder]) {
                return undefined;
            }
            var pct = 100 * $scope.scanProgress[folder].current / $scope.scanProgress[folder].total;
            return Math.floor(pct);
        };

        $scope.scanRate = function (folder) {
            if (!$scope.scanProgress[folder]) {
                return 0;
            }
            return $scope.scanProgress[folder].rate;
        };

        $scope.scanRemaining = function (folder) {
            // Formats the remaining scan time as a string. Includes days and
            // hours only when relevant, resulting in time stamps like:
            // 00m 40s
            // 32m 40s
            // 2h 32m
            // 4d 2h

            if (!$scope.scanProgress[folder]) {
                return "";
            }
            // Calculate remaining bytes and seconds based on our current
            // rate.

            var remainingBytes = $scope.scanProgress[folder].total - $scope.scanProgress[folder].current;
            var seconds = remainingBytes / $scope.scanProgress[folder].rate;
            // Round up to closest ten seconds to avoid flapping too much to
            // and fro.

            seconds = Math.ceil(seconds / 10) * 10;

            // Separate out the number of days.
            var days = 0;
            var res = [];
            if (seconds >= 86400) {
                days = Math.floor(seconds / 86400);
                res.push('' + days + 'd')
                seconds = seconds % 86400;
            }

            // Separate out the number of hours.
            var hours = 0;
            if (seconds > 3600) {
                hours = Math.floor(seconds / 3600);
                res.push('' + hours + 'h')
                seconds = seconds % 3600;
            }

            var d = new Date(1970, 0, 1).setSeconds(seconds);

            if (days === 0) {
                // Format minutes only if we're within a day of completion.
                var f = $filter('date')(d, "m'm'");
                res.push(f);
            }

            if (days === 0 && hours === 0) {
                // Format seconds only when we're within an hour of completion.
                var f = $filter('date')(d, "ss's'");
                res.push(f);
            }

            return res.join(' ');
        };

        $scope.deviceStatus = function (deviceCfg) {
            if ($scope.deviceFolders(deviceCfg).length === 0) {
                return 'unused';
            }

            if (typeof $scope.connections[deviceCfg.deviceID] === 'undefined') {
                return 'unknown';
            }

            if (deviceCfg.paused) {
                return 'paused';
            }

            if ($scope.connections[deviceCfg.deviceID].connected) {
                if ($scope.completion[deviceCfg.deviceID] && $scope.completion[deviceCfg.deviceID]._total === 100) {
                    return 'insync';
                } else {
                    return 'syncing';
                }
            }

            // Disconnected
            return 'disconnected';
        };

        $scope.deviceClass = function (deviceCfg) {
            if ($scope.deviceFolders(deviceCfg).length === 0) {
                // Unused
                return 'warning';
            }

            if (typeof $scope.connections[deviceCfg.deviceID] === 'undefined') {
                return 'info';
            }

            if (deviceCfg.paused) {
                return 'default';
            }

            if ($scope.connections[deviceCfg.deviceID].connected) {
                if ($scope.completion[deviceCfg.deviceID] && $scope.completion[deviceCfg.deviceID]._total === 100) {
                    return 'success';
                } else {
                    return 'primary';
                }
            }

            // Disconnected
            return 'info';
        };

        $scope.dappboxStatus = function () {
            var syncCount = 0;
            var notifyCount = 0;
            var pauseCount = 0;

            // loop through all folders
            var folderListCache = $scope.folderList();
            for (var i = 0; i < folderListCache.length; i++) {
                var status = $scope.folderStatus(folderListCache[i]);
                switch (status) {
                    case 'syncing':
                        syncCount++;
                        break;
                    case 'stopped':
                    case 'unknown':
                    case 'outofsync':
                    case 'error':
                        notifyCount++;
                        break;
                }
            }

            // loop through all devices
            var deviceCount = $scope.devices.length;
            for (var i = 0; i < $scope.devices.length; i++) {
                var status = $scope.deviceStatus({
                    deviceID:$scope.devices[i].deviceID
                });
                switch (status) {
                    case 'unknown':
                        notifyCount++;
                        break;
                    case 'paused':
                        pauseCount++;
                        break;
                    case 'unused':
                        deviceCount--;
                        break;
                }
            }

            // enumerate notifications
            if ($scope.openNoAuth || !$scope.configInSync || Object.keys($scope.deviceRejections).length > 0 || Object.keys($scope.folderRejections).length > 0 || $scope.errorList().length > 0 || !online) {
                notifyCount++;
            }

            // at least one folder is syncing
            if (syncCount > 0) {
                return 'sync';
            }

            // a device is unknown or a folder is stopped/unknown/outofsync/error or some other notification is open or gui offline
            if (notifyCount > 0) {
                return 'notify';
            }

            // all used devices are paused except (this) one
            if (pauseCount === deviceCount-1) {
                return 'pause';
            }

            return 'default';
        };

        $scope.deviceAddr = function (deviceCfg) {
            var conn = $scope.connections[deviceCfg.deviceID];
            if (conn && conn.connected) {
                return conn.address;
            }
            return '?';
        };

        $scope.deviceCompletion = function (deviceCfg) {
            var conn = $scope.connections[deviceCfg.deviceID];
            if (conn) {
                return conn.completion + '%';
            }
            return '';
        };

        $scope.friendlyNameFromShort = function (shortID) {
            var matches = $scope.devices.filter(function (n) {
                return n.deviceID.substr(0, 7) === shortID;
            });
            if (matches.length !== 1) {
                return shortID;
            }
            return matches[0].name;
        };

        $scope.findDevice = function (deviceID) {
            var matches = $scope.devices.filter(function (n) {
                return n.deviceID === deviceID;
            });
            if (matches.length !== 1) {
                return undefined;
            }
            return matches[0];
        };

        $scope.deviceName = function (deviceCfg) {
            if (typeof deviceCfg === 'undefined' || typeof deviceCfg.deviceID === 'undefined') {
                return "";
            }
            if (deviceCfg.name) {
                return deviceCfg.name;
            }
            return deviceCfg.deviceID.substr(0, 6);
        };

        $scope.thisDeviceName = function () {
            var device = $scope.thisDevice();
            if (typeof device === 'undefined') {
                return "(unknown device)";
            }
            if (device.name) {
                return device.name;
            }
            return device.deviceID.substr(0, 6);
        };

        $scope.setDevicePause = function (device, pause) {
            $scope.devices.forEach(function (cfg) {
                if (cfg.deviceID == device) {
                    cfg.paused = pause;
                }
            });
            $scope.config.devices = $scope.devices;
            $scope.saveConfig();
        };

        $scope.setFolderPause = function (folder, pause) {
            var cfg = $scope.folders[folder];
            $scope.visibleFolders();
            if (cfg) {
                cfg.paused = pause;
                $scope.config.folders = folderList($scope.folders);
                $scope.saveConfig();
            }
        };

        $scope.showDiscoveryFailures = function () {
            $('#discovery-failures').modal();
        };

        // $scope.editSettings = function () {
        //     // Make a working copy
        //     $scope.tmpOptions = angular.copy($scope.config.options);
        //     $scope.tmpOptions.urEnabled = ($scope.tmpOptions.urAccepted > 0);
        //     $scope.tmpOptions.deviceName = $scope.thisDevice().name;
        //     $scope.tmpOptions.upgrades = "none";
        //     if ($scope.tmpOptions.autoUpgradeIntervalH > 0) {
        //         $scope.tmpOptions.upgrades = "stable";
        //     }
        //     if ($scope.tmpOptions.upgradeToPreReleases) {
        //         $scope.tmpOptions.upgrades = "candidate";
        //     }
        //     $scope.tmpGUI = angular.copy($scope.config.gui);
        //     $('#settings').modal();
        // };

        $scope.saveConfig = function (cb) {
            var cfg = JSON.stringify($scope.config);
            var opts = {
                headers: {
                    'Content-Type': 'application/json'
                }
            };
            $http.post(urlbase + '/system/config', cfg, opts).success(function () {
                $http.get(urlbase + '/system/config/insync').success(function (data) {
                    $scope.configInSync = data.configInSync;
                    if (cb) {
                        cb();
                    }
                });
            }).error($scope.emitHTTPError);
        };

        $scope.saveAdvanced = function () {
            $scope.config = $scope.advancedConfig;
            $scope.saveConfig();
            $('#advanced').modal("hide");
        };

        // $scope.restart = function () {
        //     restarting = true;
        //     $('#restarting').modal();
        //     $http.post(urlbase + '/system/restart');
        //     $scope.configInSync = true;
        //
        //     // Switch webpage protocol if needed
        //     if ($scope.protocolChanged) {
        //         var protocol = 'http';
        //
        //         if ($scope.config.gui.useTLS) {
        //             protocol = 'https';
        //         }
        //
        //         setTimeout(function () {
        //             window.location.protocol = protocol;
        //         }, 2500);
        //
        //         $scope.protocolChanged = false;
        //     }
        // };

        // $scope.upgrade = function () {
        //     restarting = true;
        //     $('#majorUpgrade').modal('hide');
        //     $('#upgrading').modal();
        //     $http.post(urlbase + '/system/upgrade').success(function () {
        //         $('#restarting').modal();
        //         $('#upgrading').modal('hide');
        //     }).error(function () {
        //         $('#upgrading').modal('hide');
        //     });
        // };

        $scope.shutdown = function () {
            restarting = true;
            $http.post(urlbase + '/system/shutdown').success(function () {
                $('#shutdown').modal();
            }).error($scope.emitHTTPError);
            $scope.configInSync = true;
        };

        $scope.editDevice = function (deviceCfg) {
            $scope.currentDevice = $.extend({}, deviceCfg);
            $scope.editingExisting = true;
            $scope.willBeReintroducedBy = undefined;
             if (deviceCfg.introducedBy) {
                var introducerDevice = $scope.findDevice(deviceCfg.introducedBy);
                if (introducerDevice && introducerDevice.introducer) {
                    $scope.willBeReintroducedBy = $scope.deviceName(introducerDevice);
                }
            }
            $scope.currentDevice._addressesStr = deviceCfg.addresses.join(', ');
            $scope.currentDevice.selectedFolders = {};
            $scope.deviceFolders($scope.currentDevice).forEach(function (folder) {
                $scope.currentDevice.selectedFolders[folder] = true;
            });
            $scope.deviceEditor.$setPristine();
            $('#editDevice').modal();
        };

        $scope.addDevice = function (deviceID, name, ethaddrss) {
            return $http.get(urlbase + '/system/discovery')
                .success(function (registry) {
                    $scope.discovery = registry;
                })
                .then(function () {
                    $scope.currentDevice = {
                        name: name,
                        deviceID: deviceID,
                        _addressesStr: 'dynamic',
                        compression: 'metadata',
                        introducer: false,
                        ethaddress: ethaddrss,
                        selectedFolders: {}
                    };
                    $scope.editingExisting = false;
                    $scope.deviceEditor.$setPristine();
                    $('#editDevice').modal();
                });
        };

        $scope.deleteDevice = function () {
            $('#editDevice').modal('hide');
            if (!$scope.editingExisting) {
                return;
            }

            $scope.devices = $scope.devices.filter(function (n) {
                return n.deviceID !== $scope.currentDevice.deviceID;
            });
            $scope.config.devices = $scope.devices;
            // In case we later added the device manually, remove the ignoral
            // record.
            $scope.config.ignoredDevices = $scope.config.ignoredDevices.filter(function (id) {
                return id !== $scope.currentDevice.deviceID;
            });

            for (var id in $scope.folders) {
                $scope.folders[id].devices = $scope.folders[id].devices.filter(function (n) {
                    return n.deviceID !== $scope.currentDevice.deviceID;
                });
            }

            $scope.saveConfig();
        };

        $scope.saveDevice = function () {
            $('#editDevice').modal('hide');
            $scope.saveDeviceConfig($scope.currentDevice);
            $scope.dismissDeviceRejection($scope.currentDevice.deviceID);
        };

        $scope.saveDeviceConfig = function (deviceCfg) {
            deviceCfg.addresses = deviceCfg._addressesStr.split(',').map(function (x) {
                return x.trim();
            });

            var done = false;
            for (var i = 0; i < $scope.devices.length && !done; i++) {
                if ($scope.devices[i].deviceID === deviceCfg.deviceID) {
                    $scope.devices[i] = deviceCfg;
                    done = true;
                }
            }

            if (!done) {
                $scope.devices.push(deviceCfg);
            }

            $scope.devices.sort(deviceCompare);
            $scope.config.devices = $scope.devices;
            // In case we are adding the device manually, remove the ignoral
            // record.
            $scope.config.ignoredDevices = $scope.config.ignoredDevices.filter(function (id) {
                return id !== deviceCfg.deviceID;
            });

            for (var id in deviceCfg.selectedFolders) {
                if (deviceCfg.selectedFolders[id]) {
                    var found = false;
                    for (i = 0; i < $scope.folders[id].devices.length; i++) {
                        if ($scope.folders[id].devices[i].deviceID === deviceCfg.deviceID) {
                            found = true;
                            break;
                        }
                    }

                    if (!found) {
                        $scope.folders[id].devices.push({
                            deviceID: deviceCfg.deviceID
                        });
                    }
                } else {
                    $scope.folders[id].devices = $scope.folders[id].devices.filter(function (n) {
                        return n.deviceID !== deviceCfg.deviceID;
                    });
                }
            }

            $scope.saveConfig();
        };

        $scope.dismissDeviceRejection = function (device) {
            delete $scope.deviceRejections[device];
        };

        $scope.ignoreRejectedDevice = function (device) {
            $scope.config.ignoredDevices.push(device);
            $scope.saveConfig();
            $scope.dismissDeviceRejection(device);
        };

        $scope.otherDevices = function () {
            return $scope.devices.filter(function (n) {
                return n.deviceID !== $scope.myID;
            });
        };

        $scope.thisDevice = function () {
            for (var i = 0; i < $scope.devices.length; i++) {
                var n = $scope.devices[i];
                if (n.deviceID === $scope.myID) {
                    return n;
                }
            }
        };

        $scope.allDevices = function () {
            var devices = $scope.otherDevices();
            devices.push($scope.thisDevice());
            return devices;
        };

        $scope.errorList = function () {
            if (!$scope.errors) {
                return [];
            }
            return $scope.errors.filter(function (e) {
                return e.when > $scope.seenError;
            });
        };

        $scope.clearErrors = function () {
            $scope.seenError = $scope.errors[$scope.errors.length - 1].when;
            $http.post(urlbase + '/system/error/clear');
        };

        $scope.friendlyDevices = function (str) {
            for (var i = 0; i < $scope.devices.length; i++) {
                var cfg = $scope.devices[i];
                str = str.replace(cfg.deviceID, $scope.deviceName(cfg));
            }
            return str;
        };

        $scope.folderList = function () {
            return folderList($scope.folders);
        };

        $scope.directoryList = [];

        $scope.$watch('currentFolder.path', function (newvalue) {
            if (newvalue && newvalue.trim().charAt(0) === '~') {
                $scope.currentFolder.path = $scope.system.tilde + newvalue.trim().substring(1);
            }
            $http.get(urlbase + '/system/browse', {
                params: { current: newvalue }
            }).success(function (data) {
                $scope.directoryList = data;
            }).error($scope.emitHTTPError);
        });

        $scope.loadFormIntoScope = function (form) {
            console.log('loadFormIntoScope',form.$name);
            switch (form.$name) {
                case 'deviceEditor':
                    $scope.deviceEditor = form;
                    break;
                case 'folderEditor':
                    $scope.folderEditor = form;
                    break;
            }
        };

        $scope.globalChanges = function () {
            $('#globalChanges').modal();
        };

        $scope.editFolderModal = function () {
            $scope.folderPathErrors = {};
            $scope.folderEditor.$setPristine();
            $('#editIgnores textarea').val("");
            $('#editFolder').modal();
        };

        $scope.editFolder = function (folderCfg) {
            $scope.currentFolder = angular.copy(folderCfg);
            if ($scope.currentFolder.path.slice(-1) === $scope.system.pathSeparator) {
                $scope.currentFolder.path = $scope.currentFolder.path.slice(0, -1);
            }
            $scope.currentFolder.selectedDevices = {};
            $scope.currentFolder.devices.forEach(function (n) {
                $scope.currentFolder.selectedDevices[n.deviceID] = true;
            });
            $scope.currentFolder.selectedCategories = $scope.currentFolder.categories;
            if ($scope.currentFolder.versioning && $scope.currentFolder.versioning.type === "trashcan") {
                $scope.currentFolder.trashcanFileVersioning = true;
                $scope.currentFolder.fileVersioningSelector = "trashcan";
                $scope.currentFolder.trashcanClean = +$scope.currentFolder.versioning.params.cleanoutDays;
            } else if ($scope.currentFolder.versioning && $scope.currentFolder.versioning.type === "simple") {
                $scope.currentFolder.simpleFileVersioning = true;
                $scope.currentFolder.fileVersioningSelector = "simple";
                $scope.currentFolder.simpleKeep = +$scope.currentFolder.versioning.params.keep;
            } else if ($scope.currentFolder.versioning && $scope.currentFolder.versioning.type === "staggered") {
                $scope.currentFolder.staggeredFileVersioning = true;
                $scope.currentFolder.fileVersioningSelector = "staggered";
                $scope.currentFolder.staggeredMaxAge = Math.floor(+$scope.currentFolder.versioning.params.maxAge / 86400);
                $scope.currentFolder.staggeredCleanInterval = +$scope.currentFolder.versioning.params.cleanInterval;
                $scope.currentFolder.staggeredVersionsPath = $scope.currentFolder.versioning.params.versionsPath;
            } else if ($scope.currentFolder.versioning && $scope.currentFolder.versioning.type === "external") {
                $scope.currentFolder.externalFileVersioning = true;
                $scope.currentFolder.fileVersioningSelector = "external";
                $scope.currentFolder.externalCommand = $scope.currentFolder.versioning.params.command;
            } else {
                $scope.currentFolder.fileVersioningSelector = "none";
            }
            $scope.currentFolder.trashcanClean = $scope.currentFolder.trashcanClean || 0; // weeds out nulls and undefineds
            $scope.currentFolder.simpleKeep = $scope.currentFolder.simpleKeep || 5;
            $scope.currentFolder.staggeredCleanInterval = $scope.currentFolder.staggeredCleanInterval || 3600;
            $scope.currentFolder.staggeredVersionsPath = $scope.currentFolder.staggeredVersionsPath || "";

            // staggeredMaxAge can validly be zero, which we should not replace
            // with the default value of 365. So only set the default if it's
            // actually undefined.
            if (typeof $scope.currentFolder.staggeredMaxAge === 'undefined') {
                $scope.currentFolder.staggeredMaxAge = 365;
            }
            $scope.currentFolder.externalCommand = $scope.currentFolder.externalCommand || "";

            $scope.editingExisting = true;
            $scope.editFolderModal();
        };


        $scope.addFolder = function () {
            $http.get(urlbase + '/svc/random/string?length=10').success(function (data) {
                $scope.currentFolder = angular.copy($scope.folderDefaults);
                $scope.currentFolder.id = (data.random.substr(0, 5) + '-' + data.random.substr(5, 5)).toLowerCase();
                $scope.editingExisting = false;
                $scope.currentFolder.selectedCategories = "Default";
                $scope.editFolderModal();
            });
        };

        $scope.addFolderAndShare = function (folder, folderLabel, folderCategories ,device) {
            $scope.dismissFolderRejection(folder, device);
            $scope.currentFolder = angular.copy($scope.folderDefaults);
            $scope.currentFolder.id = folder;
            $scope.currentFolder.label = folderLabel;
            $scope.currentFolder.selectedCategories = folderCategories;
            $scope.shareCat = false
            $scope.currentFolder.viewFlags = {
                importFromOtherDevice: true
            };
            $scope.currentFolder.selectedDevices[device] = true;

            $scope.editingExisting = false;
            $scope.editFolderModal();
        };

        $scope.shareFolderWithDevice = function (folder, device) {
            $scope.folders[folder].devices.push({
                deviceID: device
            });
            $scope.config.folders = folderList($scope.folders);
            $scope.saveConfig();
            $scope.dismissFolderRejection(folder, device);
        };

        $scope.saveFolder = function () {
            $('#editFolder').modal('hide')
            var folderCfg = $scope.currentFolder;
            var pathCat = false;

            folderCfg.devices = [];
            folderCfg.categories = $scope.currentFolder.selectedCategories;
            folderCfg.selectedDevices[$scope.myID] = true;
            for (var deviceID in folderCfg.selectedDevices) {
                if (folderCfg.selectedDevices[deviceID] === true) {
                    folderCfg.devices.push({
                        deviceID: deviceID
                    });
                }
            }
            delete folderCfg.selectedDevices;

            if($scope.shareCat == true){
              while (pathCat == false) {
                var c = 0;
                for (var i = 0; i < $scope.categories.length; i++) {
                  for (var j = 0; j < $scope.categories[i].SubCategories.length; j++) {
                    if ($scope.currentFolder.selectedCategories == $scope.categories[i].SubCategories[j]){
                      folderCfg.categories = $scope.categories[i].Name + "/" + folderCfg.categories;
                      $scope.currentFolder.selectedCategories = $scope.categories[i].Name;
                      c = 1
                      break;
                    }
                  }
                }
                if (c == 0){
                  pathCat = true;
                }
              }
            } else {
              $scope.shareCat = true;
              var sharedcategories = $scope.currentFolder.selectedCategories.split("/");
              for (var i = sharedcategories.length; i > 0; i--) {
                if (existCategory(sharedcategories[i-1]) == false) {
                  if ( i == sharedcategories.length){
                    $scope.categories.push({Name: sharedcategories[i-1], SubCategories: ["None"]});
                  } else {
                    $scope.categories.push({Name: sharedcategories[i-1], SubCategories: [sharedcategories[i]]});
                  }
                }
              }
            }

            delete folderCfg.selectedCategories;

            if (folderCfg.fileVersioningSelector === "trashcan") {
                folderCfg.versioning = {
                    'Type': 'trashcan',
                    'Params': {
                        'cleanoutDays': '' + folderCfg.trashcanClean
                    }
                };
                delete folderCfg.trashcanFileVersioning;
                delete folderCfg.trashcanClean;
            } else if (folderCfg.fileVersioningSelector === "simple") {
                folderCfg.versioning = {
                    'Type': 'simple',
                    'Params': {
                        'keep': '' + folderCfg.simpleKeep
                    }
                };
                delete folderCfg.simpleFileVersioning;
                delete folderCfg.simpleKeep;
            } else if (folderCfg.fileVersioningSelector === "staggered") {
                folderCfg.versioning = {
                    'type': 'staggered',
                    'params': {
                        'maxAge': '' + (folderCfg.staggeredMaxAge * 86400),
                        'cleanInterval': '' + folderCfg.staggeredCleanInterval,
                        'versionsPath': '' + folderCfg.staggeredVersionsPath
                    }
                };
                delete folderCfg.staggeredFileVersioning;
                delete folderCfg.staggeredMaxAge;
                delete folderCfg.staggeredCleanInterval;
                delete folderCfg.staggeredVersionsPath;

            } else if (folderCfg.fileVersioningSelector === "external") {
                folderCfg.versioning = {
                    'Type': 'external',
                    'Params': {
                        'command': '' + folderCfg.externalCommand
                    }
                };
                delete folderCfg.externalFileVersioning;
                delete folderCfg.externalCommand;
            } else {
                delete folderCfg.versioning;
            }

            var ignores = $('#editIgnores textarea').val().trim();
            if (!$scope.editingExisting && ignores) {
                folderCfg.paused = true;
            };

            $scope.folders[folderCfg.id] = folderCfg;
            $scope.config.folders = folderList($scope.folders);

            $scope.saveConfig(function () {
                if (!$scope.editingExisting && ignores) {
                    $scope.saveIgnores(function () {
                        $scope.setFolderPause(folderCfg.id, false);
                    });
                }
            });
        };

        $scope.dismissFolderRejection = function (folder, device) {
            delete $scope.folderRejections[folder + "-" + device];
        };

        $scope.ignoreRejectedFolder = function (folder, device) {
            $scope.config.ignoredFolders.push(folder);
            $scope.saveConfig();
            $scope.dismissFolderRejection(folder, device);
        };

        $scope.sharesFolder = function (folderCfg) {
            var names = [];
            folderCfg.devices.forEach(function (device) {
                if (device.deviceID !== $scope.myID) {
                    names.push($scope.deviceName($scope.findDevice(device.deviceID)));
                }
            });
            names.sort();
            return names.join(", ");
        };

        $scope.deviceFolders = function (deviceCfg) {
            var folders = [];
            for (var folderID in $scope.folders) {
                var devices = $scope.folders[folderID].devices;
                for (var i = 0; i < devices.length; i++) {
                    if (devices[i].deviceID === deviceCfg.deviceID) {
                        folders.push(folderID);
                        break;
                    }
                }
            }

            folders.sort(folderCompare);
            return folders;
        };

        $scope.folderLabel = function (folderID) {
            var label = $scope.folders[folderID].label;
            return label.length > 0 ? label : folderID;
        }

        $scope.deleteFolder = function (id) {
            $('#editFolder').modal('hide');
            if (!$scope.editingExisting) {
                return;
            }

            delete $scope.folders[id];
            delete $scope.model[id];
            $scope.config.folders = folderList($scope.folders);
            recalcLocalStateTotal();

            $scope.saveConfig();
        };

        $scope.editIgnores = function () {
            if (!$scope.editingExisting) {
                return;
            }

            $('#editIgnoresButton').attr('disabled', 'disabled');
            $http.get(urlbase + '/db/ignores?folder=' + encodeURIComponent($scope.currentFolder.id))
                .success(function (data) {
                    data.ignore = data.ignore || [];
                    var textArea = $('#editIgnores textarea');
                    textArea.val(data.ignore.join('\n'));
                    $('#editIgnores').modal()
                        .one('shown.bs.modal', function () {
                            textArea.focus();
                        });
                })
                .then(function () {
                    $('#editIgnoresButton').removeAttr('disabled');
                });
        };

        $scope.editIgnoresOnAddingFolder = function () {
            if ($scope.editingExisting) {
                return;
            }

            if ($scope.currentFolder.path.endsWith($scope.system.pathSeparator)) {
                $scope.currentFolder.path = $scope.currentFolder.path.slice(0, -1);
            };
            $('#editIgnores').modal().one('shown.bs.modal', function () {
                textArea.focus();
            });
        };


        $scope.saveIgnores = function (cb) {
            $http.post(urlbase + '/db/ignores?folder=' + encodeURIComponent($scope.currentFolder.id), {
                ignore: $('#editIgnores textarea').val().split('\n')
            }).success(function () {
                if (cb) {
                    cb();
                }
            });
        };

        $scope.setAPIKey = function (cfg) {
            $http.get(urlbase + '/svc/random/string?length=32').success(function (data) {
                cfg.apiKey = data.random;
            });
        };

        $scope.acceptUR = function () {
            $scope.config.options.urAccepted = 1000; // Larger than the largest existing report version
            $scope.saveConfig();
            $('#ur').modal('hide');
        };

        $scope.declineUR = function () {
            $scope.config.options.urAccepted = -1;
            $scope.saveConfig();
            $('#ur').modal('hide');
        };

        $scope.showNeed = function (folder) {
            $scope.neededFolder = folder;
            refreshNeed(folder);
            $('#needed').modal().on('hidden.bs.modal', function () {
                $scope.neededFolder = undefined;
                $scope.needed = undefined;
                $scope.neededTotal = 0;
                $scope.neededCurrentPage = 1;
            });
        };

        $scope.showFailed = function (folder) {
            $scope.failedCurrent = $scope.failed[folder];
            $scope.failedFolderPath = $scope.folders[folder].path;
            if ($scope.failedFolderPath[$scope.failedFolderPath.length - 1] !== $scope.system.pathSeparator) {
                $scope.failedFolderPath += $scope.system.pathSeparator;
            }
            $('#failed').modal().on('hidden.bs.modal', function () {
                $scope.failedCurrent = undefined;
            });
        };

        $scope.hasFailedFiles = function (folder) {
            if (!$scope.failed[folder]) {
                return false;
            }
            if ($scope.failed[folder].length === 0) {
                return false;
            }
            return true;
        };

        $scope.override = function (folder) {
            $http.post(urlbase + "/db/override?folder=" + encodeURIComponent(folder));
        };

        $scope.advanced = function () {
            $scope.advancedConfig = angular.copy($scope.config);
            $('#advanced').modal('show');
        };

        $scope.showReportPreview = function () {
            $scope.reportPreview = true;
        };

        $scope.rescanFolder = function (folder) {
            $http.post(urlbase + "/db/scan?folder=" + encodeURIComponent(folder));
        };

        $scope.bumpFile = function (folder, file) {
            var url = urlbase + "/db/prio?folder=" + encodeURIComponent(folder) + "&file=" + encodeURIComponent(file);
            // In order to get the right view of data in the response.
            url += "&page=" + $scope.neededCurrentPage;
            url += "&perpage=" + $scope.neededPageSize;
            $http.post(url).success(function (data) {
                if ($scope.neededFolder === folder) {
                    console.log("bumpFile", folder, data);
                    parseNeeded(data);
                }
            }).error($scope.emitHTTPError);
        };

        $scope.versionString = function () {
            if (!$scope.version.version) {
                return '';
            }

            var os = {
                'darwin': 'Mac OS X',
                'dragonfly': 'DragonFly BSD',
                'freebsd': 'FreeBSD',
                'openbsd': 'OpenBSD',
                'netbsd': 'NetBSD',
                'linux': 'Linux',
                'windows': 'Windows',
                'solaris': 'Solaris'
            }[$scope.version.os] || $scope.version.os;

            var arch ={
                '386': '32 bit',
                'amd64': '64 bit',
                'arm': 'ARM',
                'arm64': 'AArch64',
                'ppc64': 'PowerPC',
                'ppc64le': 'PowerPC (LE)'
            }[$scope.version.arch] || $scope.version.arch;

            return $scope.version.version + ', ' + os + ' (' + arch + ')';
        };

        $scope.inputTypeFor = function (key, value) {
            if (key.substr(0, 1) === '_') {
                return 'skip';
            }
            if (value === null) {
                return 'null';
            }
            if (typeof value === 'number') {
                return 'number';
            }
            if (typeof value === 'boolean') {
                return 'checkbox';
            }
            if (value instanceof Array) {
                return 'list';
            }
            if (typeof value === 'object') {
                return 'skip';
            }
            return 'text';
        };

        $scope.themeName = function (theme) {
            return theme.replace('-', ' ').replace(/(?:^|\s)\S/g, function (a) {
                return a.toUpperCase();
            });
        };

        $scope.modalLoaded = function () {
            // once all modal elements have been processed
            if ($('modal').length === 0) {

                // pseudo main. called on all definitions assigned
                initController();
            }
        };

        $scope.toggleUnits = function () {
            $scope.metricRates = !$scope.metricRates;
            try {
                window.localStorage["metricRates"] = $scope.metricRates;
            } catch (exception) { }
        };

        $scope.showFolder = function (id) {
          $('#'+id).show("slow");
        };

        $scope.hideFolder = function (id) {
          $('#'+id).hide("slow");
        };

        $scope.visibleFolders = function() {
          var folders = $scope.folderList();
          $scope.visibleFolder = [];
          for (var i = 0; i < folders.length; i++) {
            if($('#'+folders[i].id).css("display") == "block"){
              $scope.visibleFolder.push(folders[i].id);
              $scope.visible = true;
            }
          }
        };


        function graphic() {
          refreshGraphData();
          refreshEthereumGraphData();
        };

        $scope.showGraph = function(num){
          $('#'+num).show("slow");
        };

        $scope.hideGraph = function(num) {
          $('#'+num).hide("slow");
        };

        function refreshGraphData() {
          var second = 0;
          var firstDate = new Date();
          firstDate.setSeconds(firstDate.getSeconds() - 5*48);
          function generateChartData(data) {
              var chartData = [];
              for ( second = 0; second < 50; second++){
                var newDate = new Date(firstDate);
                newDate.setSeconds(newDate.getSeconds() + 5*second);
                var data = 0;
                chartData.push( {
                  "date": newDate,
                  "data": data
                } );
              }
              return chartData;
          };

            var chart1 = AmCharts.makeChart( "chartdiv1", {
              "type": "serial",
              "theme": "light",
              "zoomOutButton": {
                "backgroundColor": "#000000",
                "backgroundAlpha": 0.15
              },
              "dataProvider": generateChartData(),
              "categoryField": "date",
              "categoryAxis": {
                "title": "Time [s]",
                "minPeriod": "5ss",
                "parseDates": true,
                "dashLength": 1,
                "gridAlpha": 0.15,
                "axisColor": "#DADADA",
              },
              "valueAxes":[{
                "title": "CPU Utilization [%]",
              } ],
              "graphs": [ {
                "id": "g1",
                "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
                "valueField": "data",
                "bullet": "round",
                "bulletBorderColor": "#FFFFFF",
                "bulletBorderThickness": 2,
                "lineThickness": 2,
                "lineColor": "#b60606",
                "type": "smoothedLine",
                "hideBulletsCount": 20
              } ],
              "chartCursor": {
                "categoryBalloonDateFormat": "JJ:NN:SS",
                "cursorPosition": "mouse",
              },
              "chartScrollbar": {
                "graph": "g1",
                "scrollbarHeight": 50,
                "color": "#000000",
                "autoGridCount": true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                  "enabled": true
              }
            } )

            var chart2 = AmCharts.makeChart( "chartdiv2", {
              "type": "serial",
              "theme": "light",
              "zoomOutButton": {
                "backgroundColor": "#000000",
                "backgroundAlpha": 0.15
              },
              "dataProvider": generateChartData(),
              "categoryField": "date",
              "categoryAxis": {
                "title": "Time [s]",
                "minPeriod": "5ss",
                "parseDates": true,
                "dashLength": 1,
                "gridAlpha": 0.15,
                "axisColor": "#DADADA",
              },
              "valueAxes":[{
                "title": "RAM Utilization [MB]",
              } ],
              "graphs": [ {
                "id": "g2",
                "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
                "valueField": "data",
                "bullet": "round",
                "bulletBorderColor": "#FFFFFF",
                "bulletBorderThickness": 2,
                "lineColor": "#102777",
                "lineThickness": 2,
                "type": "smoothedLine",
                "hideBulletsCount": 20
              } ],
              "chartCursor": {
                "categoryBalloonDateFormat": "JJ:NN:SS",
                "cursorPosition": "mouse",
              },
              "chartScrollbar": {
                "graph": "g2",
                "scrollbarHeight": 50,
                "color": "#000000",
                "autoGridCount": true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                  "enabled": true
              }
            } )

            var chart3 = AmCharts.makeChart( "chartdiv3", {
              "type": "serial",
              "theme": "light",
              "zoomOutButton": {
                "backgroundColor": "#000000",
                "backgroundAlpha": 0.15
              },
              "dataProvider": generateChartData(),
              "categoryField": "date",
              "categoryAxis": {
                "title": "Time [s]",
                "minPeriod": "5ss",
                "parseDates": true,
                "dashLength": 1,
                "gridAlpha": 0.15,
                "axisColor": "#DADADA",
              },
              "valueAxes":[{
                "title": "Disk Usage [%]",
              } ],
              "graphs": [ {
                "id": "g3",
                "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
                "valueField": "data",
                "bullet": "round",
                "bulletBorderColor": "#FFFFFF",
                "bulletBorderThickness": 2,
                "lineColor": "#018942",
                "lineThickness": 2,
                "type": "smoothedLine",
                "hideBulletsCount": 20
              } ],
              "chartCursor": {
                "categoryBalloonDateFormat": "JJ:NN:SS",
                "cursorPosition": "mouse",
              },
              "chartScrollbar": {
                "graph": "g3",
                "scrollbarHeight": 50,
                "color": "#000000",
                "autoGridCount": true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                  "enabled": true
              }
            } )

            var chart4 = AmCharts.makeChart( "chartdiv4", {
              "type": "serial",
              "theme": "light",
              "zoomOutButton": {
                "backgroundColor": "#000000",
                "backgroundAlpha": 0.15
              },
              "dataProvider": generateChartData(),
              "categoryField": "date",
              "categoryAxis": {
                "title": "Time [s]",
                "minPeriod": "5ss",
                "parseDates": true,
                "dashLength": 1,
                "gridAlpha": 0.15,
                "axisColor": "#DADADA",
              },
              "valueAxes":[{
                "title": "Download Rate [bps]",
              } ],
              "graphs": [ {
                "id": "g4",
                "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
                "valueField": "data",
                "bullet": "round",
                "bulletBorderColor": "#FFFFFF",
                "bulletBorderThickness": 2,
                "lineColor": "#da8f0d",
                "lineThickness": 2,
                "type": "smoothedLine",
                "hideBulletsCount": 20
              } ],
              "chartCursor": {
                "categoryBalloonDateFormat": "JJ:NN:SS",
                "cursorPosition": "mouse",
              },
              "chartScrollbar": {
                "graph": "g4",
                "scrollbarHeight": 50,
                "color": "#000000",
                "autoGridCount": true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                  "enabled": true
              }
            } )

            var chart5 = AmCharts.makeChart( "chartdiv5", {
              "type": "serial",
              "theme": "light",
              "zoomOutButton": {
                "backgroundColor": "#000000",
                "backgroundAlpha": 0.15
              },
              "dataProvider": generateChartData(),
              "categoryField": "date",
              "categoryAxis": {
                "title": "Time [s]",
                "minPeriod": "5ss",
                "parseDates": true,
                "dashLength": 1,
                "gridAlpha": 0.15,
                "axisColor": "#DADADA",
              },
              "valueAxes":[{
                "title": "Upload Rate [bps]",
              } ],
              "graphs": [ {
                "id": "g5",
                "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
                "valueField": "data",
                "bullet": "round",
                "bulletBorderColor": "#FFFFFF",
                "bulletBorderThickness": 2,
                "lineColor": "#86398e",
                "lineThickness": 2,
                "type": "smoothedLine",
                "hideBulletsCount": 20
              } ],
              "chartCursor": {
                "categoryBalloonDateFormat": "JJ:NN:SS",
                "cursorPosition": "mouse",
              },
              "chartScrollbar": {
                "graph": "g5",
                "scrollbarHeight": 50,
                "color": "#000000",
                "autoGridCount": true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                  "enabled": true
              }
            } )

            var chart6 = AmCharts.makeChart( "chartdiv6", {
              "type": "serial",
              "theme": "light",
              "zoomOutButton": {
                "backgroundColor": "#000000",
                "backgroundAlpha": 0.15
              },
              "dataProvider": generateChartData(),
              "categoryField": "date",
              "categoryAxis": {
                "title": "Time [s]",
                "minPeriod": "5ss",
                "parseDates": true,
                "dashLength": 1,
                "gridAlpha": 0.15,
                "axisColor": "#DADADA",
              },
              "valueAxes":[{
                "title": "Bandwidth [B]",
              } ],
              "graphs": [ {
                "id": "g6",
                "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
                "valueField": "data",
                "bullet": "round",
                "bulletBorderColor": "#FFFFFF",
                "bulletBorderThickness": 2,
                "lineColor": "#e07c1a",
                "lineThickness": 2,
                "type": "smoothedLine",
                "hideBulletsCount": 20
              } ],
              "chartCursor": {
                "categoryBalloonDateFormat": "JJ:NN:SS",
                "cursorPosition": "mouse",
              },
              "chartScrollbar": {
                "graph": "g6",
                "color": "#000000",
                "scrollbarHeight": 50,
                "autoGridCount": true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                  "enabled": true
              }
            } )

            var chart8 = AmCharts.makeChart(  "chartdiv8", {
              "type": "serial",
              "theme": "light",
              "dataProvider": generateChartData(),
              "valueAxes": [ {
                "axisAlpha": 0,
                "position": "left",
                "title": "Number of Transfers",
              } ],
              "startDuration": 1,
              "graphs": [ {
                "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
                "fillColors": "#2a96a0",
                "fillAlphas": 0.8,
                "lineAlpha": 0.2,
                "type": "column",
                "valueField": "data"
              } ],
              "chartCursor": {
                "categoryBalloonDateFormat": "JJ:NN:SS",
                "cursorPosition": "mouse",
              },
              "categoryField": "date",
              "categoryAxis": {
                "title" : "Time [s]",
                "minPeriod": "5ss",
                "parseDates": true,
                "dashLength": 1,
                "gridAlpha": 0.15,
                "axisColor": "#DADADA",
                "gridPosition": "start",
                "tickPosition": "start",
                "tickLength": 20
              },
              "chartScrollbar": {
                "graph": "g8",
                "scrollbarHeight": 20,
                "color": "#000000",
                "autoGridCount": true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                "enabled": true
              }

            } )

            setInterval( function() {

              $http.get(urlbase + '/system/graphdata').success(function (data) {
                chart1.dataProvider.shift();
                chart2.dataProvider.shift();
                chart3.dataProvider.shift();
                chart4.dataProvider.shift();
                chart5.dataProvider.shift();
                chart6.dataProvider.shift();
                chart8.dataProvider.shift();

                var newDate = new Date(firstDate);
                newDate.setSeconds(newDate.getSeconds() + 5*second);
                second++;
                chart1.dataProvider.push( {
                  date: newDate,
                  data: data.cpuUsage
                } );
                chart2.dataProvider.push( {
                  date: newDate,
                  data: data.ramUsage
                } );
                chart3.dataProvider.push( {
                  date: newDate,
                  data: data.diskStUsage
                } );
                chart4.dataProvider.push( {
                  date: newDate,
                  data: data.downloadRate
                } );
                chart5.dataProvider.push( {
                  date: newDate,
                  data: data.uploadRate
                } );
                chart6.dataProvider.push( {
                  date: newDate,
                  data: data.bandwidth
                } );
                chart8.dataProvider.push( {
                  date: newDate,
                  data: data.numberTrnsfs
                } );
                chart1.validateData();
                chart2.validateData();
                chart3.validateData();
                chart4.validateData();
                chart5.validateData();
                chart6.validateData();
                chart8.validateData();

              }).error($scope.emitHTTPError);
            }, 5000);
        };

        function refreshEthereumGraphData() {
          var second = 0;
          var firstDate = new Date();
          firstDate.setSeconds(firstDate.getSeconds() - 5*48);
          function generateChartData(data) {
              var chartData = [];
              for ( second = 0; second < 50; second++){
                var newDate = new Date(firstDate);
                newDate.setSeconds(newDate.getSeconds() + 5*second);
                var data = 0;
                chartData.push( {
                  "date": newDate,
                  "data": data
                } );
              }
              return chartData;
          };

            // var chart1 = AmCharts.makeChart( "chartdiv9", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "Hash Rate",
            //   } ],
            //   "graphs": [ {
            //     "id": "g9",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineThickness": 2,
            //     "lineColor": "#b60606",
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g9",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart2 = AmCharts.makeChart( "chartdiv10", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "Chain Inserts (AvgRate01Min) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g10",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#102777",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g10",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart3 = AmCharts.makeChart( "chartdiv11", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "Chain Inserts (AvgRate05Min) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g11",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#018942",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g11",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart4 = AmCharts.makeChart( "chartdiv12", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "Chain Inserts (AvgRate15Min) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g12",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#da8f0d",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g12",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart5 = AmCharts.makeChart( "chartdiv13", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "Chain Inserts (MeanRate) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g13",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#86398e",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g13",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart6 = AmCharts.makeChart( "chartdiv14", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "Chain Inserts (Overall)",
            //   } ],
            //   "graphs": [ {
            //     "id": "g14",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#e07c1a",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g14",
            //     "color": "#000000",
            //     "scrollbarHeight": 50,
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart7 = AmCharts.makeChart( "chartdiv15", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "Chain Inserts (Percentiles 5) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g15",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineThickness": 2,
            //     "lineColor": "#b60606",
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g15",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart8 = AmCharts.makeChart( "chartdiv16", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "Chain Inserts (Percentiles 20) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g16",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#102777",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g16",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart9 = AmCharts.makeChart( "chartdiv17", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "Chain Inserts (Percentiles 50) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g17",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#018942",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g17",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart10 = AmCharts.makeChart( "chartdiv18", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "Chain Inserts (Percentiles 80) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g18",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#da8f0d",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g18",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart11 = AmCharts.makeChart( "chartdiv19", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "Chain Inserts (Percentiles 95) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g19",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#86398e",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g19",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )

            var chart12 = AmCharts.makeChart( "chartdiv20", {
              "type": "serial",
              "theme": "light",
              "zoomOutButton": {
                "backgroundColor": "#000000",
                "backgroundAlpha": 0.15
              },
              "dataProvider": generateChartData(),
              "categoryField": "date",
              "categoryAxis": {
                "title": "Time [s]",
                "minPeriod": "5ss",
                "parseDates": true,
                "dashLength": 1,
                "gridAlpha": 0.15,
                "axisColor": "#DADADA",
              },
              "valueAxes":[{
                "title": "P2P Inbound Connects (AvgRate01Min) [Hz]",
              } ],
              "graphs": [ {
                "id": "g20",
                "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
                "valueField": "data",
                "bullet": "round",
                "bulletBorderColor": "#FFFFFF",
                "bulletBorderThickness": 2,
                "lineColor": "#e07c1a",
                "lineThickness": 2,
                "type": "smoothedLine",
                "hideBulletsCount": 20
              } ],
              "chartCursor": {
                "categoryBalloonDateFormat": "JJ:NN:SS",
                "cursorPosition": "mouse",
              },
              "chartScrollbar": {
                "graph": "g20",
                "color": "#000000",
                "scrollbarHeight": 50,
                "autoGridCount": true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                  "enabled": true
              }
            } )

            var chart13 = AmCharts.makeChart( "chartdiv21", {
              "type": "serial",
              "theme": "light",
              "zoomOutButton": {
                "backgroundColor": "#000000",
                "backgroundAlpha": 0.15
              },
              "dataProvider": generateChartData(),
              "categoryField": "date",
              "categoryAxis": {
                "title": "Time [s]",
                "minPeriod": "5ss",
                "parseDates": true,
                "dashLength": 1,
                "gridAlpha": 0.15,
                "axisColor": "#DADADA",
              },
              "valueAxes":[{
                "title": "P2P Inbound Connects (AvgRate05Min) [Hz]",
              } ],
              "graphs": [ {
                "id": "g21",
                "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
                "valueField": "data",
                "bullet": "round",
                "bulletBorderColor": "#FFFFFF",
                "bulletBorderThickness": 2,
                "lineThickness": 2,
                "lineColor": "#b60606",
                "type": "smoothedLine",
                "hideBulletsCount": 20
              } ],
              "chartCursor": {
                "categoryBalloonDateFormat": "JJ:NN:SS",
                "cursorPosition": "mouse",
              },
              "chartScrollbar": {
                "graph": "g21",
                "scrollbarHeight": 50,
                "color": "#000000",
                "autoGridCount": true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                  "enabled": true
              }
            } )

            var chart14 = AmCharts.makeChart( "chartdiv22", {
              "type": "serial",
              "theme": "light",
              "zoomOutButton": {
                "backgroundColor": "#000000",
                "backgroundAlpha": 0.15
              },
              "dataProvider": generateChartData(),
              "categoryField": "date",
              "categoryAxis": {
                "title": "Time [s]",
                "minPeriod": "5ss",
                "parseDates": true,
                "dashLength": 1,
                "gridAlpha": 0.15,
                "axisColor": "#DADADA",
              },
              "valueAxes":[{
                "title": "P2P Inbound Connects (AvgRate15Min) [Hz]",
              } ],
              "graphs": [ {
                "id": "g22",
                "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
                "valueField": "data",
                "bullet": "round",
                "bulletBorderColor": "#FFFFFF",
                "bulletBorderThickness": 2,
                "lineColor": "#102777",
                "lineThickness": 2,
                "type": "smoothedLine",
                "hideBulletsCount": 20
              } ],
              "chartCursor": {
                "categoryBalloonDateFormat": "JJ:NN:SS",
                "cursorPosition": "mouse",
              },
              "chartScrollbar": {
                "graph": "g22",
                "scrollbarHeight": 50,
                "color": "#000000",
                "autoGridCount": true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                  "enabled": true
              }
            } )

            var chart15 = AmCharts.makeChart( "chartdiv23", {
              "type": "serial",
              "theme": "light",
              "zoomOutButton": {
                "backgroundColor": "#000000",
                "backgroundAlpha": 0.15
              },
              "dataProvider": generateChartData(),
              "categoryField": "date",
              "categoryAxis": {
                "title": "Time [s]",
                "minPeriod": "5ss",
                "parseDates": true,
                "dashLength": 1,
                "gridAlpha": 0.15,
                "axisColor": "#DADADA",
              },
              "valueAxes":[{
                "title": "P2P Inbound Connects (MeanRate) [Hz]",
              } ],
              "graphs": [ {
                "id": "g23",
                "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
                "valueField": "data",
                "bullet": "round",
                "bulletBorderColor": "#FFFFFF",
                "bulletBorderThickness": 2,
                "lineColor": "#018942",
                "lineThickness": 2,
                "type": "smoothedLine",
                "hideBulletsCount": 20
              } ],
              "chartCursor": {
                "categoryBalloonDateFormat": "JJ:NN:SS",
                "cursorPosition": "mouse",
              },
              "chartScrollbar": {
                "graph": "g23",
                "scrollbarHeight": 50,
                "color": "#000000",
                "autoGridCount": true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                  "enabled": true
              }
            } )

            var chart16 = AmCharts.makeChart( "chartdiv24", {
              "type": "serial",
              "theme": "light",
              "zoomOutButton": {
                "backgroundColor": "#000000",
                "backgroundAlpha": 0.15
              },
              "dataProvider": generateChartData(),
              "categoryField": "date",
              "categoryAxis": {
                "title": "Time [s]",
                "minPeriod": "5ss",
                "parseDates": true,
                "dashLength": 1,
                "gridAlpha": 0.15,
                "axisColor": "#DADADA",
              },
              "valueAxes":[{
                "title": "P2P Inbound Connects (Overall) [Hz]",
              } ],
              "graphs": [ {
                "id": "g24",
                "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
                "valueField": "data",
                "bullet": "round",
                "bulletBorderColor": "#FFFFFF",
                "bulletBorderThickness": 2,
                "lineColor": "#da8f0d",
                "lineThickness": 2,
                "type": "smoothedLine",
                "hideBulletsCount": 20
              } ],
              "chartCursor": {
                "categoryBalloonDateFormat": "JJ:NN:SS",
                "cursorPosition": "mouse",
              },
              "chartScrollbar": {
                "graph": "g24",
                "scrollbarHeight": 50,
                "color": "#000000",
                "autoGridCount": true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                  "enabled": true
              }
            } )

            var chart17 = AmCharts.makeChart( "chartdiv25", {
              "type": "serial",
              "theme": "light",
              "zoomOutButton": {
                "backgroundColor": "#000000",
                "backgroundAlpha": 0.15
              },
              "dataProvider": generateChartData(),
              "categoryField": "date",
              "categoryAxis": {
                "title": "Time [s]",
                "minPeriod": "5ss",
                "parseDates": true,
                "dashLength": 1,
                "gridAlpha": 0.15,
                "axisColor": "#DADADA",
              },
              "valueAxes":[{
                "title": "P2P Inbound Traffic (AvgRate01Min) [Hz]",
              } ],
              "graphs": [ {
                "id": "g25",
                "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
                "valueField": "data",
                "bullet": "round",
                "bulletBorderColor": "#FFFFFF",
                "bulletBorderThickness": 2,
                "lineColor": "#86398e",
                "lineThickness": 2,
                "type": "smoothedLine",
                "hideBulletsCount": 20
              } ],
              "chartCursor": {
                "categoryBalloonDateFormat": "JJ:NN:SS",
                "cursorPosition": "mouse",
              },
              "chartScrollbar": {
                "graph": "g25",
                "scrollbarHeight": 50,
                "color": "#000000",
                "autoGridCount": true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                  "enabled": true
              }
            } )

            var chart18 = AmCharts.makeChart( "chartdiv26", {
              "type": "serial",
              "theme": "light",
              "zoomOutButton": {
                "backgroundColor": "#000000",
                "backgroundAlpha": 0.15
              },
              "dataProvider": generateChartData(),
              "categoryField": "date",
              "categoryAxis": {
                "title": "Time [s]",
                "minPeriod": "5ss",
                "parseDates": true,
                "dashLength": 1,
                "gridAlpha": 0.15,
                "axisColor": "#DADADA",
              },
              "valueAxes":[{
                "title": "P2P Inbound Traffic (AvgRate05Min) [Hz]",
              } ],
              "graphs": [ {
                "id": "g26",
                "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
                "valueField": "data",
                "bullet": "round",
                "bulletBorderColor": "#FFFFFF",
                "bulletBorderThickness": 2,
                "lineColor": "#e07c1a",
                "lineThickness": 2,
                "type": "smoothedLine",
                "hideBulletsCount": 20
              } ],
              "chartCursor": {
                "categoryBalloonDateFormat": "JJ:NN:SS",
                "cursorPosition": "mouse",
              },
              "chartScrollbar": {
                "graph": "g26",
                "color": "#000000",
                "scrollbarHeight": 50,
                "autoGridCount": true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                  "enabled": true
              }
            } )

            var chart19 = AmCharts.makeChart( "chartdiv27", {
              "type": "serial",
              "theme": "light",
              "zoomOutButton": {
                "backgroundColor": "#000000",
                "backgroundAlpha": 0.15
              },
              "dataProvider": generateChartData(),
              "categoryField": "date",
              "categoryAxis": {
                "title": "Time [s]",
                "minPeriod": "5ss",
                "parseDates": true,
                "dashLength": 1,
                "gridAlpha": 0.15,
                "axisColor": "#DADADA",
              },
              "valueAxes":[{
                "title": "P2P Inbound Traffic (AvgRate15Min) [Hz]",
              } ],
              "graphs": [ {
                "id": "g27",
                "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
                "valueField": "data",
                "bullet": "round",
                "bulletBorderColor": "#FFFFFF",
                "bulletBorderThickness": 2,
                "lineThickness": 2,
                "lineColor": "#b60606",
                "type": "smoothedLine",
                "hideBulletsCount": 20
              } ],
              "chartCursor": {
                "categoryBalloonDateFormat": "JJ:NN:SS",
                "cursorPosition": "mouse",
              },
              "chartScrollbar": {
                "graph": "g27",
                "scrollbarHeight": 50,
                "color": "#000000",
                "autoGridCount": true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                  "enabled": true
              }
            } )

            var chart20 = AmCharts.makeChart( "chartdiv28", {
              "type": "serial",
              "theme": "light",
              "zoomOutButton": {
                "backgroundColor": "#000000",
                "backgroundAlpha": 0.15
              },
              "dataProvider": generateChartData(),
              "categoryField": "date",
              "categoryAxis": {
                "title": "Time [s]",
                "minPeriod": "5ss",
                "parseDates": true,
                "dashLength": 1,
                "gridAlpha": 0.15,
                "axisColor": "#DADADA",
              },
              "valueAxes":[{
                "title": "P2P Inbound Traffic (MeanRate) [Hz]",
              } ],
              "graphs": [ {
                "id": "g28",
                "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
                "valueField": "data",
                "bullet": "round",
                "bulletBorderColor": "#FFFFFF",
                "bulletBorderThickness": 2,
                "lineColor": "#102777",
                "lineThickness": 2,
                "type": "smoothedLine",
                "hideBulletsCount": 20
              } ],
              "chartCursor": {
                "categoryBalloonDateFormat": "JJ:NN:SS",
                "cursorPosition": "mouse",
              },
              "chartScrollbar": {
                "graph": "g28",
                "scrollbarHeight": 50,
                "color": "#000000",
                "autoGridCount": true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                  "enabled": true
              }
            } )

            var chart21 = AmCharts.makeChart( "chartdiv29", {
              "type": "serial",
              "theme": "light",
              "zoomOutButton": {
                "backgroundColor": "#000000",
                "backgroundAlpha": 0.15
              },
              "dataProvider": generateChartData(),
              "categoryField": "date",
              "categoryAxis": {
                "title": "Time [s]",
                "minPeriod": "5ss",
                "parseDates": true,
                "dashLength": 1,
                "gridAlpha": 0.15,
                "axisColor": "#DADADA",
              },
              "valueAxes":[{
                "title": "P2P Inbound Traffic (Overall) [Hz]",
              } ],
              "graphs": [ {
                "id": "g29",
                "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
                "valueField": "data",
                "bullet": "round",
                "bulletBorderColor": "#FFFFFF",
                "bulletBorderThickness": 2,
                "lineColor": "#018942",
                "lineThickness": 2,
                "type": "smoothedLine",
                "hideBulletsCount": 20
              } ],
              "chartCursor": {
                "categoryBalloonDateFormat": "JJ:NN:SS",
                "cursorPosition": "mouse",
              },
              "chartScrollbar": {
                "graph": "g29",
                "scrollbarHeight": 50,
                "color": "#000000",
                "autoGridCount": true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                  "enabled": true
              }
            } )

            var chart22 = AmCharts.makeChart( "chartdiv30", {
              "type": "serial",
              "theme": "light",
              "zoomOutButton": {
                "backgroundColor": "#000000",
                "backgroundAlpha": 0.15
              },
              "dataProvider": generateChartData(),
              "categoryField": "date",
              "categoryAxis": {
                "title": "Time [s]",
                "minPeriod": "5ss",
                "parseDates": true,
                "dashLength": 1,
                "gridAlpha": 0.15,
                "axisColor": "#DADADA",
              },
              "valueAxes":[{
                "title": "P2P Outbound Connects (AvgRate01Min) [Hz]",
              } ],
              "graphs": [ {
                "id": "g30",
                "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
                "valueField": "data",
                "bullet": "round",
                "bulletBorderColor": "#FFFFFF",
                "bulletBorderThickness": 2,
                "lineColor": "#da8f0d",
                "lineThickness": 2,
                "type": "smoothedLine",
                "hideBulletsCount": 20
              } ],
              "chartCursor": {
                "categoryBalloonDateFormat": "JJ:NN:SS",
                "cursorPosition": "mouse",
              },
              "chartScrollbar": {
                "graph": "g30",
                "scrollbarHeight": 50,
                "color": "#000000",
                "autoGridCount": true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                  "enabled": true
              }
            } )

            var chart23 = AmCharts.makeChart( "chartdiv31", {
              "type": "serial",
              "theme": "light",
              "zoomOutButton": {
                "backgroundColor": "#000000",
                "backgroundAlpha": 0.15
              },
              "dataProvider": generateChartData(),
              "categoryField": "date",
              "categoryAxis": {
                "title": "Time [s]",
                "minPeriod": "5ss",
                "parseDates": true,
                "dashLength": 1,
                "gridAlpha": 0.15,
                "axisColor": "#DADADA",
              },
              "valueAxes":[{
                "title": "P2P Outbound Connects (AvgRate05Min) [Hz]",
              } ],
              "graphs": [ {
                "id": "g31",
                "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
                "valueField": "data",
                "bullet": "round",
                "bulletBorderColor": "#FFFFFF",
                "bulletBorderThickness": 2,
                "lineColor": "#86398e",
                "lineThickness": 2,
                "type": "smoothedLine",
                "hideBulletsCount": 20
              } ],
              "chartCursor": {
                "categoryBalloonDateFormat": "JJ:NN:SS",
                "cursorPosition": "mouse",
              },
              "chartScrollbar": {
                "graph": "g31",
                "scrollbarHeight": 50,
                "color": "#000000",
                "autoGridCount": true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                  "enabled": true
              }
            } )

            var chart24 = AmCharts.makeChart( "chartdiv32", {
              "type": "serial",
              "theme": "light",
              "zoomOutButton": {
                "backgroundColor": "#000000",
                "backgroundAlpha": 0.15
              },
              "dataProvider": generateChartData(),
              "categoryField": "date",
              "categoryAxis": {
                "title": "Time [s]",
                "minPeriod": "5ss",
                "parseDates": true,
                "dashLength": 1,
                "gridAlpha": 0.15,
                "axisColor": "#DADADA",
              },
              "valueAxes":[{
                "title": "P2P Outbound Connects (AvgRate15Min) [Hz]",
              } ],
              "graphs": [ {
                "id": "g32",
                "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
                "valueField": "data",
                "bullet": "round",
                "bulletBorderColor": "#FFFFFF",
                "bulletBorderThickness": 2,
                "lineColor": "#e07c1a",
                "lineThickness": 2,
                "type": "smoothedLine",
                "hideBulletsCount": 20
              } ],
              "chartCursor": {
                "categoryBalloonDateFormat": "JJ:NN:SS",
                "cursorPosition": "mouse",
              },
              "chartScrollbar": {
                "graph": "g32",
                "color": "#000000",
                "scrollbarHeight": 50,
                "autoGridCount": true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                  "enabled": true
              }
            } )

            var chart25 = AmCharts.makeChart( "chartdiv33", {
              "type": "serial",
              "theme": "light",
              "zoomOutButton": {
                "backgroundColor": "#000000",
                "backgroundAlpha": 0.15
              },
              "dataProvider": generateChartData(),
              "categoryField": "date",
              "categoryAxis": {
                "title": "Time [s]",
                "minPeriod": "5ss",
                "parseDates": true,
                "dashLength": 1,
                "gridAlpha": 0.15,
                "axisColor": "#DADADA",
              },
              "valueAxes":[{
                "title": "P2P Outbound Connects (MeanRate) [Hz]",
              } ],
              "graphs": [ {
                "id": "g33",
                "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
                "valueField": "data",
                "bullet": "round",
                "bulletBorderColor": "#FFFFFF",
                "bulletBorderThickness": 2,
                "lineThickness": 2,
                "lineColor": "#b60606",
                "type": "smoothedLine",
                "hideBulletsCount": 20
              } ],
              "chartCursor": {
                "categoryBalloonDateFormat": "JJ:NN:SS",
                "cursorPosition": "mouse",
              },
              "chartScrollbar": {
                "graph": "g33",
                "scrollbarHeight": 50,
                "color": "#000000",
                "autoGridCount": true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                  "enabled": true
              }
            } )

            var chart26 = AmCharts.makeChart( "chartdiv34", {
              "type": "serial",
              "theme": "light",
              "zoomOutButton": {
                "backgroundColor": "#000000",
                "backgroundAlpha": 0.15
              },
              "dataProvider": generateChartData(),
              "categoryField": "date",
              "categoryAxis": {
                "title": "Time [s]",
                "minPeriod": "5ss",
                "parseDates": true,
                "dashLength": 1,
                "gridAlpha": 0.15,
                "axisColor": "#DADADA",
              },
              "valueAxes":[{
                "title": "P2P Outbound Connects (Overall) [Hz]",
              } ],
              "graphs": [ {
                "id": "g34",
                "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
                "valueField": "data",
                "bullet": "round",
                "bulletBorderColor": "#FFFFFF",
                "bulletBorderThickness": 2,
                "lineColor": "#102777",
                "lineThickness": 2,
                "type": "smoothedLine",
                "hideBulletsCount": 20
              } ],
              "chartCursor": {
                "categoryBalloonDateFormat": "JJ:NN:SS",
                "cursorPosition": "mouse",
              },
              "chartScrollbar": {
                "graph": "g34",
                "scrollbarHeight": 50,
                "color": "#000000",
                "autoGridCount": true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                  "enabled": true
              }
            } )

            var chart27 = AmCharts.makeChart( "chartdiv35", {
              "type": "serial",
              "theme": "light",
              "zoomOutButton": {
                "backgroundColor": "#000000",
                "backgroundAlpha": 0.15
              },
              "dataProvider": generateChartData(),
              "categoryField": "date",
              "categoryAxis": {
                "title": "Time [s]",
                "minPeriod": "5ss",
                "parseDates": true,
                "dashLength": 1,
                "gridAlpha": 0.15,
                "axisColor": "#DADADA",
              },
              "valueAxes":[{
                "title": "P2P Outbound Traffic (AvgRate01Min) [Hz]",
              } ],
              "graphs": [ {
                "id": "g35",
                "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
                "valueField": "data",
                "bullet": "round",
                "bulletBorderColor": "#FFFFFF",
                "bulletBorderThickness": 2,
                "lineColor": "#018942",
                "lineThickness": 2,
                "type": "smoothedLine",
                "hideBulletsCount": 20
              } ],
              "chartCursor": {
                "categoryBalloonDateFormat": "JJ:NN:SS",
                "cursorPosition": "mouse",
              },
              "chartScrollbar": {
                "graph": "g35",
                "scrollbarHeight": 50,
                "color": "#000000",
                "autoGridCount": true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                  "enabled": true
              }
            } )

            var chart28 = AmCharts.makeChart( "chartdiv36", {
              "type": "serial",
              "theme": "light",
              "zoomOutButton": {
                "backgroundColor": "#000000",
                "backgroundAlpha": 0.15
              },
              "dataProvider": generateChartData(),
              "categoryField": "date",
              "categoryAxis": {
                "title": "Time [s]",
                "minPeriod": "5ss",
                "parseDates": true,
                "dashLength": 1,
                "gridAlpha": 0.15,
                "axisColor": "#DADADA",
              },
              "valueAxes":[{
                "title": "P2P Outbound Traffic (AvgRate05Min) [Hz]",
              } ],
              "graphs": [ {
                "id": "g36",
                "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
                "valueField": "data",
                "bullet": "round",
                "bulletBorderColor": "#FFFFFF",
                "bulletBorderThickness": 2,
                "lineColor": "#da8f0d",
                "lineThickness": 2,
                "type": "smoothedLine",
                "hideBulletsCount": 20
              } ],
              "chartCursor": {
                "categoryBalloonDateFormat": "JJ:NN:SS",
                "cursorPosition": "mouse",
              },
              "chartScrollbar": {
                "graph": "g36",
                "scrollbarHeight": 50,
                "color": "#000000",
                "autoGridCount": true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                  "enabled": true
              }
            } )

            var chart29 = AmCharts.makeChart( "chartdiv37", {
              "type": "serial",
              "theme": "light",
              "zoomOutButton": {
                "backgroundColor": "#000000",
                "backgroundAlpha": 0.15
              },
              "dataProvider": generateChartData(),
              "categoryField": "date",
              "categoryAxis": {
                "title": "Time [s]",
                "minPeriod": "5ss",
                "parseDates": true,
                "dashLength": 1,
                "gridAlpha": 0.15,
                "axisColor": "#DADADA",
              },
              "valueAxes":[{
                "title": "P2P Outbound Traffic (AvgRate15Min) [Hz]",
              } ],
              "graphs": [ {
                "id": "g37",
                "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
                "valueField": "data",
                "bullet": "round",
                "bulletBorderColor": "#FFFFFF",
                "bulletBorderThickness": 2,
                "lineColor": "#86398e",
                "lineThickness": 2,
                "type": "smoothedLine",
                "hideBulletsCount": 20
              } ],
              "chartCursor": {
                "categoryBalloonDateFormat": "JJ:NN:SS",
                "cursorPosition": "mouse",
              },
              "chartScrollbar": {
                "graph": "g37",
                "scrollbarHeight": 50,
                "color": "#000000",
                "autoGridCount": true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                  "enabled": true
              }
            } )

            var chart30 = AmCharts.makeChart( "chartdiv38", {
              "type": "serial",
              "theme": "light",
              "zoomOutButton": {
                "backgroundColor": "#000000",
                "backgroundAlpha": 0.15
              },
              "dataProvider": generateChartData(),
              "categoryField": "date",
              "categoryAxis": {
                "title": "Time [s]",
                "minPeriod": "5ss",
                "parseDates": true,
                "dashLength": 1,
                "gridAlpha": 0.15,
                "axisColor": "#DADADA",
              },
              "valueAxes":[{
                "title": "P2P Outbound Traffic (MeanRate) [Hz]",
              } ],
              "graphs": [ {
                "id": "g38",
                "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
                "valueField": "data",
                "bullet": "round",
                "bulletBorderColor": "#FFFFFF",
                "bulletBorderThickness": 2,
                "lineColor": "#e07c1a",
                "lineThickness": 2,
                "type": "smoothedLine",
                "hideBulletsCount": 20
              } ],
              "chartCursor": {
                "categoryBalloonDateFormat": "JJ:NN:SS",
                "cursorPosition": "mouse",
              },
              "chartScrollbar": {
                "graph": "g38",
                "color": "#000000",
                "scrollbarHeight": 50,
                "autoGridCount": true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                  "enabled": true
              }
            } )

            var chart31 = AmCharts.makeChart( "chartdiv39", {
              "type": "serial",
              "theme": "light",
              "zoomOutButton": {
                "backgroundColor": "#000000",
                "backgroundAlpha": 0.15
              },
              "dataProvider": generateChartData(),
              "categoryField": "date",
              "categoryAxis": {
                "title": "Time [s]",
                "minPeriod": "5ss",
                "parseDates": true,
                "dashLength": 1,
                "gridAlpha": 0.15,
                "axisColor": "#DADADA",
              },
              "valueAxes":[{
                "title": "P2P Outbound Traffic (Overall) [Hz]",
              } ],
              "graphs": [ {
                "id": "g39",
                "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
                "valueField": "data",
                "bullet": "round",
                "bulletBorderColor": "#FFFFFF",
                "bulletBorderThickness": 2,
                "lineThickness": 2,
                "lineColor": "#b60606",
                "type": "smoothedLine",
                "hideBulletsCount": 20
              } ],
              "chartCursor": {
                "categoryBalloonDateFormat": "JJ:NN:SS",
                "cursorPosition": "mouse",
              },
              "chartScrollbar": {
                "graph": "g39",
                "scrollbarHeight": 50,
                "color": "#000000",
                "autoGridCount": true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                  "enabled": true
              }
            } )

            // var chart32 = AmCharts.makeChart( "chartdiv40", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Disk Read Count (AvgRate01Min) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g40",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#102777",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g40",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart33 = AmCharts.makeChart( "chartdiv41", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Disk Read Count (AvgRate05Min) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g41",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#018942",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g41",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart34 = AmCharts.makeChart( "chartdiv42", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Disk Read Count (AvgRate15Min) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g42",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#da8f0d",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g42",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart35 = AmCharts.makeChart( "chartdiv43", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Disk Read Count (MeanRate) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g43",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#86398e",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g43",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart36 = AmCharts.makeChart( "chartdiv44", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Disk Read Count (Overall) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g44",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#e07c1a",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g44",
            //     "color": "#000000",
            //     "scrollbarHeight": 50,
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart37 = AmCharts.makeChart( "chartdiv45", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Disk Read Data (AvgRate01Min) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g45",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineThickness": 2,
            //     "lineColor": "#b60606",
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "scrollbarHeight": 50,
            //     "graph": "g45",
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart38 = AmCharts.makeChart( "chartdiv46", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Disk Read Data (AvgRate05Min) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g46",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#102777",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g46",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart39 = AmCharts.makeChart( "chartdiv47", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Disk Read Data (AvgRate15Min) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g47",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#018942",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g47",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart40 = AmCharts.makeChart( "chartdiv48", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Disk Read Data (MeanRate) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g48",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#da8f0d",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g48",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart41 = AmCharts.makeChart( "chartdiv49", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Disk Read Data (Overall) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g49",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#86398e",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g49",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart42 = AmCharts.makeChart( "chartdiv50", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Disk Write Count (AvgRate01Min) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g50",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#e07c1a",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g50",
            //     "color": "#000000",
            //     "scrollbarHeight": 50,
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart43 = AmCharts.makeChart( "chartdiv51", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Disk Write Count (AvgRate05Min) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g51",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineThickness": 2,
            //     "lineColor": "#b60606",
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g51",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart44 = AmCharts.makeChart( "chartdiv52", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Disk Write Count (AvgRate15Min) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g52",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#102777",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g52",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart45 = AmCharts.makeChart( "chartdiv53", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Disk Write Count (MeanRate) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g53",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#018942",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g53",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart46 = AmCharts.makeChart( "chartdiv54", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Disk Write Count (Overall) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g54",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#da8f0d",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g54",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart47 = AmCharts.makeChart( "chartdiv55", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Disk Write Data (AvgRate01Min) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g55",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#86398e",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g55",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart48 = AmCharts.makeChart( "chartdiv56", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Disk Write Data (AvgRate05Min) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g56",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#e07c1a",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g56",
            //     "color": "#000000",
            //     "scrollbarHeight": 50,
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart49 = AmCharts.makeChart( "chartdiv57", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Disk Write Data (AvgRate15Min) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g57",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineThickness": 2,
            //     "lineColor": "#b60606",
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g57",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart50 = AmCharts.makeChart( "chartdiv58", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Disk Write Data (MeanRate) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g58",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#102777",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g58",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart51 = AmCharts.makeChart( "chartdiv59", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Disk Write Data (Overall) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g59",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#018942",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g59",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart52 = AmCharts.makeChart( "chartdiv60", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Memory Allocs (AvgRate01Min) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g60",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#da8f0d",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g60",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart53 = AmCharts.makeChart( "chartdiv61", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Memory Allocs (AvgRate05Min) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g61",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#86398e",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g61",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart54 = AmCharts.makeChart( "chartdiv62", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Memory Allocs (AvgRate15Min) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g62",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#e07c1a",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g62",
            //     "color": "#000000",
            //     "scrollbarHeight": 50,
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart55 = AmCharts.makeChart( "chartdiv63", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Memory Allocs (MeanRate) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g63",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineThickness": 2,
            //     "lineColor": "#b60606",
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g63",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart56 = AmCharts.makeChart( "chartdiv64", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Memory Allocs (Overall) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g64",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#102777",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g64",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart57 = AmCharts.makeChart( "chartdiv65", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Memory Frees (AvgRate01Min) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g65",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#018942",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g65",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart58 = AmCharts.makeChart( "chartdiv66", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Memory Frees (AvgRate05Min) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g66",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#da8f0d",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g66",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart59 = AmCharts.makeChart( "chartdiv67", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Memory Frees (AvgRate15Min) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g67",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#86398e",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g67",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart60 = AmCharts.makeChart( "chartdiv68", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Memory Frees (MeanRate) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g68",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#e07c1a",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g68",
            //     "color": "#000000",
            //     "scrollbarHeight": 50,
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart61 = AmCharts.makeChart( "chartdiv69", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Memory Frees (Overall) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g69",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#018942",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g69",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart62 = AmCharts.makeChart( "chartdiv70", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Memory Inuse (AvgRate01Min) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g70",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#da8f0d",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g70",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart63 = AmCharts.makeChart( "chartdiv71", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Memory Inuse (AvgRate05Min) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g71",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#86398e",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g71",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart64 = AmCharts.makeChart( "chartdiv72", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Memory Inuse (AvgRate15Min) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g72",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#e07c1a",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g72",
            //     "color": "#000000",
            //     "scrollbarHeight": 50,
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart65 = AmCharts.makeChart( "chartdiv73", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Memory Inuse (MeanRate) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g73",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineThickness": 2,
            //     "lineColor": "#b60606",
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g73",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart66 = AmCharts.makeChart( "chartdiv74", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Memory Inuse (Overall) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g74",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#102777",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g74",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart67 = AmCharts.makeChart( "chartdiv75", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Memory Pauses (AvgRate01Min) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g75",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#018942",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g75",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart68 = AmCharts.makeChart( "chartdiv76", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Memory Pauses (AvgRate05Min) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g76",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#da8f0d",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g76",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart69 = AmCharts.makeChart( "chartdiv77", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Memory Pauses (AvgRate15Min) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g77",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#86398e",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g77",
            //     "scrollbarHeight": 50,
            //     "color": "#000000",
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart70 = AmCharts.makeChart( "chartdiv78", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Memory Pauses (MeanRate) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g78",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#e07c1a",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g78",
            //     "color": "#000000",
            //     "scrollbarHeight": 50,
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )
            //
            // var chart71 = AmCharts.makeChart( "chartdiv79", {
            //   "type": "serial",
            //   "theme": "light",
            //   "zoomOutButton": {
            //     "backgroundColor": "#000000",
            //     "backgroundAlpha": 0.15
            //   },
            //   "dataProvider": generateChartData(),
            //   "categoryField": "date",
            //   "categoryAxis": {
            //     "title": "Time [s]",
            //     "minPeriod": "5ss",
            //     "parseDates": true,
            //     "dashLength": 1,
            //     "gridAlpha": 0.15,
            //     "axisColor": "#DADADA",
            //   },
            //   "valueAxes":[{
            //     "title": "System Memory Pauses (Overall) [Hz]",
            //   } ],
            //   "graphs": [ {
            //     "id": "g79",
            //     "balloonText": "[[category]]<br><b><span style='font-size:14px;'>[[value]]</span></b>",
            //     "valueField": "data",
            //     "bullet": "round",
            //     "bulletBorderColor": "#FFFFFF",
            //     "bulletBorderThickness": 2,
            //     "lineColor": "#e07c1a",
            //     "lineThickness": 2,
            //     "type": "smoothedLine",
            //     "hideBulletsCount": 20
            //   } ],
            //   "chartCursor": {
            //     "categoryBalloonDateFormat": "JJ:NN:SS",
            //     "cursorPosition": "mouse",
            //   },
            //   "chartScrollbar": {
            //     "graph": "g79",
            //     "color": "#000000",
            //     "scrollbarHeight": 50,
            //     "autoGridCount": true
            //   },
            //   "responsive": {
            //     "enabled": true
            //   },
            //   "export": {
            //       "enabled": true
            //   }
            // } )

            setInterval( function() {

              $http.get(urlbase + '/system/ethereumgraph').success(function (data) {
                // chart1.dataProvider.shift();
                // chart2.dataProvider.shift();
                // chart3.dataProvider.shift();
                // chart4.dataProvider.shift();
                // chart5.dataProvider.shift();
                // chart6.dataProvider.shift();
                // chart7.dataProvider.shift();
                // chart8.dataProvider.shift();
                // chart9.dataProvider.shift();
                // chart10.dataProvider.shift();
                // chart11.dataProvider.shift();
                chart12.dataProvider.shift();
                chart13.dataProvider.shift();
                chart14.dataProvider.shift();
                chart15.dataProvider.shift();
                chart16.dataProvider.shift();
                chart17.dataProvider.shift();
                chart18.dataProvider.shift();
                chart19.dataProvider.shift();
                chart20.dataProvider.shift();
                chart21.dataProvider.shift();
                chart22.dataProvider.shift();
                chart23.dataProvider.shift();
                chart24.dataProvider.shift();
                chart25.dataProvider.shift();
                chart26.dataProvider.shift();
                chart27.dataProvider.shift();
                chart28.dataProvider.shift();
                chart29.dataProvider.shift();
                chart30.dataProvider.shift();
                chart31.dataProvider.shift();
                // chart32.dataProvider.shift();
                // chart33.dataProvider.shift();
                // chart34.dataProvider.shift();
                // chart35.dataProvider.shift();
                // chart36.dataProvider.shift();
                // chart37.dataProvider.shift();
                // chart38.dataProvider.shift();
                // chart39.dataProvider.shift();
                // chart40.dataProvider.shift();
                // chart41.dataProvider.shift();
                // chart42.dataProvider.shift();
                // chart43.dataProvider.shift();
                // chart44.dataProvider.shift();
                // chart45.dataProvider.shift();
                // chart46.dataProvider.shift();
                // chart47.dataProvider.shift();
                // chart48.dataProvider.shift();
                // chart49.dataProvider.shift();
                // chart50.dataProvider.shift();
                // chart51.dataProvider.shift();
                // chart52.dataProvider.shift();
                // chart53.dataProvider.shift();
                // chart54.dataProvider.shift();
                // chart55.dataProvider.shift();
                // chart56.dataProvider.shift();
                // chart57.dataProvider.shift();
                // chart58.dataProvider.shift();
                // chart59.dataProvider.shift();
                // chart60.dataProvider.shift();
                // chart61.dataProvider.shift();
                // chart62.dataProvider.shift();
                // chart63.dataProvider.shift();
                // chart64.dataProvider.shift();
                // chart65.dataProvider.shift();
                // chart66.dataProvider.shift();
                // chart67.dataProvider.shift();
                // chart68.dataProvider.shift();
                // chart69.dataProvider.shift();
                // chart70.dataProvider.shift();
                // chart71.dataProvider.shift();

                var newDate = new Date(firstDate);
                newDate.setSeconds(newDate.getSeconds() + 5*second);
                second++;
                // chart1.dataProvider.push( {
                //   date: newDate,
                //   data: data.HashrateNow
                // } );
                // chart2.dataProvider.push( {
                //   date: newDate,
                //   data: data.chain[0]
                // } );
                // chart3.dataProvider.push( {
                //   date: newDate,
                //   data: data.chain[1]
                // } );
                // chart4.dataProvider.push( {
                //   date: newDate,
                //   data: data.chain[2]
                // } );
                // chart5.dataProvider.push( {
                //   date: newDate,
                //   data: data.chain[3]
                // } );
                // chart6.dataProvider.push( {
                //   date: newDate,
                //   data: data.chain[4]
                // } );
                // chart7.dataProvider.push( {
                //   date: newDate,
                //   data: data.chain[5]
                // } );
                // chart8.dataProvider.push( {
                //   date: newDate,
                //   data: data.chain[6]
                // } );
                // chart9.dataProvider.push( {
                //   date: newDate,
                //   data: data.chain[7]
                // } );
                // chart10.dataProvider.push( {
                //   date: newDate,
                //   data: data.chain[8]
                // } );
                // chart11.dataProvider.push( {
                //   date: newDate,
                //   data: data.chain[9]
                // } );
                chart12.dataProvider.push( {
                  date: newDate,
                  data: data.p2pInboundConnects[0]
                } );
                chart13.dataProvider.push( {
                  date: newDate,
                  data: data.p2pInboundConnects[1]
                } );
                chart14.dataProvider.push( {
                  date: newDate,
                  data: data.p2pInboundConnects[2]
                } );
                chart15.dataProvider.push( {
                  date: newDate,
                  data: data.p2pInboundConnects[3]
                } );
                chart16.dataProvider.push( {
                  date: newDate,
                  data: data.p2pInboundConnects[4]
                } );
                chart17.dataProvider.push( {
                  date: newDate,
                  data: data.p2pInboundTraffic[0]
                } );
                chart18.dataProvider.push( {
                  date: newDate,
                  data: data.p2pInboundTraffic[1]
                } );
                chart19.dataProvider.push( {
                  date: newDate,
                  data: data.p2pInboundTraffic[2]
                } );
                chart20.dataProvider.push( {
                  date: newDate,
                  data: data.p2pInboundTraffic[3]
                } );
                chart21.dataProvider.push( {
                  date: newDate,
                  data: data.p2pInboundTraffic[4]
                } );
                chart22.dataProvider.push( {
                  date: newDate,
                  data: data.p2pOutboundConnects[0]
                } );
                chart23.dataProvider.push( {
                  date: newDate,
                  data: data.p2pOutboundConnects[1]
                } );
                chart24.dataProvider.push( {
                  date: newDate,
                  data: data.p2pOutboundConnects[2]
                } );
                chart25.dataProvider.push( {
                  date: newDate,
                  data: data.p2pOutboundConnects[3]
                } );
                chart26.dataProvider.push( {
                  date: newDate,
                  data: data.p2pOutboundConnects[4]
                } );
                chart27.dataProvider.push( {
                  date: newDate,
                  data: data.p2pOutboundTraffic[0]
                } );
                chart28.dataProvider.push( {
                  date: newDate,
                  data: data.p2pOutboundTraffic[1]
                } );
                chart29.dataProvider.push( {
                  date: newDate,
                  data: data.p2pOutboundTraffic[2]
                } );
                chart30.dataProvider.push( {
                  date: newDate,
                  data: data.p2pOutboundTraffic[3]
                } );
                chart31.dataProvider.push( {
                  date: newDate,
                  data: data.p2pOutboundTraffic[4]
                } );
                // chart32.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemDiskReadCount[0]
                // } );
                // chart33.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemDiskReadCount[1]
                // } );
                // chart34.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemDiskReadCount[2]
                // } );
                // chart35.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemDiskReadCount[3]
                // } );
                // chart36.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemDiskReadCount[4]
                // } );
                // chart37.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemDiskReadData[0]
                // } );
                // chart38.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemDiskReadData[1]
                // } );
                // chart39.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemDiskReadData[2]
                // } );
                // chart40.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemDiskReadData[3]
                // } );
                // chart41.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemDiskReadData[4]
                // } );
                // chart42.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemDiskWriteCount[0]
                // } );
                // chart43.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemDiskWriteCount[1]
                // } );
                // chart44.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemDiskWriteCount[2]
                // } );
                // chart45.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemDiskWriteCount[3]
                // } );
                // chart46.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemDiskWriteCount[4]
                // } );
                // chart47.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemDiskWriteData[0]
                // } );
                // chart48.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemDiskWriteData[1]
                // } );
                // chart49.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemDiskWriteData[2]
                // } );
                // chart50.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemDiskWriteData[3]
                // } );
                // chart51.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemDiskWriteData[4]
                // } );
                // chart52.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemMemoryAllocs[0]
                // } );
                // chart53.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemMemoryAllocs[1]
                // } );
                // chart54.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemMemoryAllocs[2]
                // } );
                // chart55.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemMemoryAllocs[3]
                // } );
                // chart56.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemMemoryAllocs[4]
                // } );
                // chart57.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemMemoryFrees[0]
                // } );
                // chart58.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemMemoryFrees[1]
                // } );
                // chart59.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemMemoryFrees[2]
                // } );
                // chart60.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemMemoryFrees[3]
                // } );
                // chart61.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemMemoryFrees[4]
                // } );
                // chart62.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemMemoryInuse[0]
                // } );
                // chart63.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemMemoryInuse[1]
                // } );
                // chart64.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemMemoryInuse[2]
                // } );
                // chart65.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemMemoryInuse[3]
                // } );
                // chart66.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemMemoryInuse[4]
                // } );
                // chart67.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemMemoryPauses[0]
                // } );
                // chart68.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemMemoryPauses[1]
                // } );
                // chart69.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemMemoryPauses[2]
                // } );
                // chart70.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemMemoryPauses[3]
                // } );
                // chart71.dataProvider.push( {
                //   date: newDate,
                //   data: data.systemMemoryPauses[4]
                // } );

                // chart1.validateData();
                // chart2.validateData();
                // chart3.validateData();
                // chart4.validateData();
                // chart5.validateData();
                // chart6.validateData();
                // chart7.validateData();
                // chart8.validateData();
                // chart9.validateData();
                // chart10.validateData();
                // chart11.validateData();
                chart12.validateData();
                chart13.validateData();
                chart14.validateData();
                chart15.validateData();
                chart16.validateData();
                chart17.validateData();
                chart18.validateData();
                chart19.validateData();
                chart20.validateData();
                chart21.validateData();
                chart22.validateData();
                chart23.validateData();
                chart25.validateData();
                chart24.validateData();
                chart26.validateData();
                chart27.validateData();
                chart28.validateData();
                chart29.validateData();
                chart30.validateData();
                chart31.validateData();
                // chart32.validateData();
                // chart33.validateData();
                // chart34.validateData();
                // chart35.validateData();
                // chart36.validateData();
                // chart37.validateData();
                // chart38.validateData();
                // chart39.validateData();
                // chart40.validateData();
                // chart41.validateData();
                // chart42.validateData();
                // chart43.validateData();
                // chart44.validateData();
                // chart45.validateData();
                // chart46.validateData();
                // chart47.validateData();
                // chart48.validateData();
                // chart49.validateData();
                // chart50.validateData();
                // chart51.validateData();
                // chart52.validateData();
                // chart53.validateData();
                // chart54.validateData();
                // chart55.validateData();
                // chart56.validateData();
                // chart57.validateData();
                // chart58.validateData();
                // chart59.validateData();
                // chart60.validateData();
                // chart61.validateData();
                // chart62.validateData();
                // chart63.validateData();
                // chart64.validateData();
                // chart65.validateData();
                // chart66.validateData();
                // chart67.validateData();
                // chart68.validateData();
                // chart69.validateData();
                // chart70.validateData();
                // chart71.validateData();

              }).error($scope.emitHTTPError);
            }, 5000);
        };

        $scope.refreshPieGraphData = function () {
          $http.get(urlbase + '/system/piegraphdata').success(function (data) {
            if ($scope.diskStUsage != data.diskStUsage){
              $scope.diskStUsage = data.diskStUsage;
              var chart7 = AmCharts.makeChart("chartdiv7", {
                "type": "pie",
                "theme": "light",
                "dataProvider": [ {
                  "memory": "DappBox",
                  "percent": data.diskStUsage
                }, {
                  "memory": "Used",
                  "percent": data.diskUsedMem
                }, {
                  "memory": "Free",
                  "percent": data.diskFreeMem
                } ],
                "valueField": "percent",
                "titleField": "memory",
                "balloon":{
                 "fixedPosition":true
                },
                "responsive": {
                  "enabled": true
                },
                "export": {
                  "enabled": true
                }
              } )
            }
          }).error($scope.emitHTTPError);
        };

        function pieData() {
          $http.get(urlbase + '/system/piegraphdata').success(function (data) {
            $scope.diskStUsage = data.diskStUsage;
            var chart7 = AmCharts.makeChart("chartdiv7", {
              "type": "pie",
              "theme": "light",
              "dataProvider": [ {
                "memory": "DappBox",
                "percent": data.diskStUsage
              }, {
                "memory": "Used",
                "percent": data.diskUsedMem
              }, {
                "memory": "Free",
                "percent": data.diskFreeMem
              } ],
              "valueField": "percent",
              "titleField": "memory",
              "balloon":{
               "fixedPosition":true
              },
              "responsive": {
                "enabled": true
              },
              "export": {
                "enabled": true
              }
            } )
          }).error($scope.emitHTTPError);
        };

        function tableData() {
            $http.get(urlbase + '/system/tabledata').success(function (data) {
              var table = data.arrayStatus;
              for (var i = 0; i < table.length; i++) {
                var dataTable = {"status": data.arrayStatus[i],
                                 "item": data.arrayItem[i],
                                 "time": data.arrayTime[i].slice(0,19)};
              $scope.tableData["row"+i]=dataTable;
              }
            }).error($scope.emitHTTPError);
        };

        $scope.refreshTableData = function () {
            $http.get(urlbase + '/system/tabledata').success(function (data) {
              var table = data.arrayStatus;
              for (var i = 0; i < table.length; i++) {
                var dataTable = {"status": data.arrayStatus[i],
                                 "item": data.arrayItem[i],
                                 "time": data.arrayTime[i].slice(0,19)};
              $scope.tableData["row"+i]=dataTable;
              }
            }).error($scope.emitHTTPError);
        };

        function verifyGraph(id){
          if ($('#'+id).css("display") == "none"){
            return false;
          } else {
            return true;
          }
        };

        $scope.dataTable = function () {
          var table = $scope.tableData;
          return table;
        };

        $scope.showDevice = function (id) {
          $('#'+id).show("slow");
        };

        $scope.hideDevice = function (id) {
          $('#'+id).hide("slow");
        };

        function folderData() {
            $http.get(urlbase + '/system/folderdata').success(function (data) {
              var table = data.arrayStatus;
              for (var i = 0; i < table.length; i++) {
                    var dataFolder = {"item": data.arrayItem[i],
                                 "itemHash": data.arrayItemHash[i],
                                 "nodeID": data.arrayNodeID[i],
                                 "nodeHash": data.arrayNodeHash[i],
                                 "time": data.arrayTime[i].slice(0,19),
                                 "state": data.arrayStatus[i],
                                 "foldID": data.arrayFolderID[i]};

              $scope.folderData["row"+i] = dataFolder;
            };
            }).error($scope.emitHTTPError);
        };

        $scope.refreshFolderData = function () {
            $http.get(urlbase + '/system/folderdata').success(function (data) {
              var table = data.arrayStatus;
              for (var i = 0; i < table.length; i++) {
                    var dataFolder = {"item": data.arrayItem[i],
                                 "itemHash": data.arrayItemHash[i],
                                 "nodeID": data.arrayNodeID[i],
                                 "nodeHash": data.arrayNodeHash[i],
                                 "time": data.arrayTime[i].slice(0,19),
                                 "state": data.arrayStatus[i],
                                 "foldID": data.arrayFolderID[i]};

              $scope.folderData["row"+i] = dataFolder;
            };
            }).error($scope.emitHTTPError);
        };

        $scope.dataFolder = function () {
          var folder = $scope.folderData;
          return folder;
        };

        $scope.generateQR = function (folderID) {
          var qrRawArray = $scope.qrRaw;
          var qrRawIDArray = $scope.qrRawID;
          for (var i = 0; i < qrRawIDArray.length; i++) {
              if (qrRawIDArray[i] == folderID) {
                  return "data:image/png;base64," + qrRawArray[i];
              };
          };
        };

        $scope.addCategory = function (id) {
          $('#'+id).show();
          $scope.category = "";
        };

        $scope.addSubCategory = function (id,category) {
          $('#'+id).show();
          $scope.category = category;
        };

        $scope.saveCategory = function (id) {
          $('#'+id).hide();
          if ($scope.addName != ''){
            if(existCategory($scope.addName) == false){
              var category = $scope.addName;
              $scope.addName = '';
              $scope.categories.push({Name: category, SubCategories:["None"]});
              if ($scope.category != ""){
                for (var i = 0; i < $scope.categories.length; i++) {
                  if ($scope.categories[i].Name == $scope.category){
                    if($scope.categories[i].SubCategories[0] == "None"){
                      $scope.categories[i].SubCategories[0] = category;
                    } else {
                      $scope.categories[i].SubCategories.push(category);
                    }
                  }
                }
              }
              $scope.config.categories = $scope.categories;
            } else {
              alert("The category exist!");
            }
          } else if ($scope.editName != '') {
            if(existCategory($scope.editName) == false){
              var category = $scope.editName;
              $scope.editName = '';
              for (var i = 0; i < $scope.categories.length; i++) {
                if ($scope.categories[i].Name == $scope.categoryName){
                  $scope.categories[i].Name = category;
                } else {
                  for (var j = 0; j < $scope.categories[i].SubCategories.length; j++){
                    if($scope.categories[i].SubCategories[j] == $scope.categoryName){
                      $scope.categories[i].SubCategories[j] = category;
                    }
                  }
                }
              }
              for (var i = 0; i < $scope.config.folders.length; i++) {
                var categoriesFolder = $scope.config.folders[i].categories.split("/");
                for (var j = 0; j < categoriesFolder.length; j++){
                  if ($scope.categoryName == categoriesFolder[j]){
                    categoriesFolder[j] = category;
                  }
                }
                $scope.config.folders[i].categories = categoriesFolder.join("/");
              }
              $scope.config.categories = $scope.categories;
            } else {
              alert("The category exist!");
            }
          }
          $scope.saveConfig();
      };

        $scope.editCategory = function (id, categoryName) {
          $scope.categoryName = categoryName;
          $('#editCat').val(categoryName);
          $('#'+id).show();
        };

        $scope.deleteCategory = function (categoryName) {
          var deleteCategories = [categoryName];

          for (var i = 0; i < $scope.config.folders.length; i++) {
            var categoriesFolder = $scope.config.folders[i].categories.split("/");
            var categoriesLength = categoriesFolder.length - 1;
            var del = -1;
            for (var j = 0; j < categoriesFolder.length; j++){
              if (categoryName == categoriesFolder[j]){
                $scope.config.folders[i].categories = "Default";
                if (j < categoriesLength){
                  del = j + 1;
                  break;
                }
              }
            }
            if (del != -1){
              for (var j = del; j < categoriesFolder.length; j++){
                deleteCategories.push(categoriesFolder[j])
              }
            }
            for (var j = 0; j < $scope.categories.length; j++) {
              for (var z = 0; z < deleteCategories.length; z++){
                if (deleteCategories[z] == $scope.categories[j].Name){
                  $scope.categories.splice(j,1);
                } else {
                    for (var k = 0; k < $scope.categories[j].SubCategories.length; k++){
                      if(categoryName == $scope.categories[j].SubCategories[k]){
                          if($scope.categories[j].SubCategories.length == 1){
                            $scope.categories[j].SubCategories[k] = "None";
                          } else {
                            $scope.categories[j].SubCategories.splice(k,1);
                          }
                      }
                    }
                }
              }
            }
          }
          $scope.config.categories = $scope.categories;
          $scope.saveConfig();
        };

        $scope.categoryList = function () {
            return $scope.categories;
        };

        function existCategory(category){
          var exist = false;
          for (var i = 0; i < $scope.categories.length; i++) {
            if (category == $scope.categories[i].Name){
              exist = true;
            }
          }
          return exist;
        };

        $scope.existSubCategory = function(category){
          var exist = false;
          for (var i = 0; i < $scope.categories.length; i++) {
            if(category == $scope.categories[i].Name){
              if($scope.categories[i].SubCategories[0] == "None"){
                exist = false;
                break;
              } else {
                exist = true;
                break;
              }
            }
          }
          return exist;
        };

        $scope.folderCategory = function(folder){
          var category = "";
          var listCategory = folder.categories.split("/");
          category = listCategory[listCategory.length - 1];
          return category;
        };

        $scope.isSubCategory = function(category){
          var exist = false;
          for (var i = 0; i < $scope.categories.length; i++) {
            for (var j = 0; j < $scope.categories[i].SubCategories.length; j++){
              if(category == $scope.categories[i].SubCategories[j]){
                exist = true;
              }
            }
          }
          return exist;
        };

        $scope.verifySubCategory = function(subcategory){
          for (var i = 0; i < $scope.categories.length; i++){
              for (var j = 0; j < $scope.categories[i].SubCategories.length; j++){
                if(subcategory == $scope.categories[i].SubCategories[j]){
                  return $scope.categories[i].Name;
                }
              }
          }
        };

        $scope.slideCategory = function(category){
          $("#"+category+"-list").slideToggle('500');
        };

        $scope.slideGraph = function(id){
          $("#"+id).slideToggle('500');
        };

        $scope.slideSidebar = function(id){
          if ($("#"+id).css('display') == "none"){
              $("#"+id).css('display','table-cell')
          } else {
              $("#"+id).css('display','none')
          }

        }

        $scope.slideCategory1 = function(category){
          $("#"+category+"-list1").slideToggle('500');
        };

        function verifyFolderCat(folders){
          for (var i = 0; i < folders.length; i++) {
            if (folders[i].categories == null){
              folders[i].categories = "Default"
            } else if (folders[i].categories == "") {
              folders[i].categories = "Default"
            }
          }
        };

        $scope.showInput = function(id){
          $("#"+id).slideToggle('500');
        }


        /*############# Contex Menu for Share files  ###############*/

        function clickInsideElement( e, className ) {
          var el = e.srcElement || e.target;
          if ( el.classList.contains(className) ) {
            return el;
          } else {
            while ( el = el.parentNode ) {
              if ( el.classList && el.classList.contains(className) ) {
                return el;
              }
            }
          }
          return false;
        }

        function getPosition(e) {
          var posx = 0;
          var posy = 0;

          if (!e) var e = window.event;
          if (e.pageX || e.pageY) {
            posx = e.pageX;
            posy = e.pageY;
          } else if (e.clientX || e.clientY) {
            posx = e.clientX + document.body.scrollLeft + document.documentElement.scrollLeft;
            posy = e.clientY + document.body.scrollTop + document.documentElement.scrollTop;
          }
          return {
            x: posx,
            y: posy
          }
        }

        var sharedFileInContext;
        var clickCoords;
        var clickCoordsX;
        var clickCoordsY;
        var menu = document.querySelector("#context-menu");
        var menuState = 0;
        var menuWidth;
        var menuHeight;
        var menuPosition;
        var windowWidth;
        var windowHeight;

        function contextListener() {
          document.addEventListener( "contextmenu", function(e) {
            sharedFileInContext = clickInsideElement( e, "shared-file" );

            if ( sharedFileInContext ) {
              e.preventDefault();
              toggleMenuOn();
              positionMenu(e);

              $scope.itemSharedFile     = e.path[1].getElementsByClassName("folder-item")[0].textContent;
              $scope.itemHashSharedFile = e.path[1].getElementsByClassName("folder-itemHash")[0].textContent;
              $scope.nodeIDSharedFile   = e.path[1].getElementsByClassName("folder-nodeID")[0].textContent;
              $scope.nodeHashSharedFile = e.path[1].getElementsByClassName("folder-nodeHash")[0].textContent;
              $scope.timeSharedFile     = e.path[1].getElementsByClassName("folder-time")[0].textContent;
              $scope.stateSharedFile    = e.path[1].getElementsByClassName("folder-state")[0].textContent;
              // console.log("___e", $scope.itemSharedFile, $scope.itemHashSharedFile, $scope.nodeIDSharedFile, $scope.nodeHashSharedFile, $scope.timeSharedFile, $scope.stateSharedFile)
            } else {
              sharedFileInContext = null;
              toggleMenuOff();
            }
          });
        }

        function clickListener() {
          document.addEventListener( "click", function(e) {
            var clickeElIsLink = clickInsideElement( e, "context-menu" );

            if ( clickeElIsLink ) {
              e.preventDefault();
            } else {
              var button = e.which || e.button;
              if ( button === 1 ) {
                toggleMenuOff();
              }
            }
          });
        }

        function keyupListener() {
          window.onkeyup = function(e) {
            if ( e.keyCode === 27 ) {
              toggleMenuOff();
            }
          }
        }

        function resizeListener() {
          window.onresize = function(e) {
            toggleMenuOff();
          };
        }

        function toggleMenuOn() {
          if ( menuState !== 1 ) {
            menuState = 1;
            menu.classList.add( "context-menu--active" );
          }
        }

        function toggleMenuOff() {
          if ( menuState !== 0 ) {
            menuState = 0;
            menu.classList.remove( "context-menu--active" );
          }
        }

        function positionMenu(e) {
          clickCoords = getPosition(e);
          clickCoordsX = clickCoords.x;
          clickCoordsY = clickCoords.y;

          menuWidth = menu.offsetWidth + 4;
          menuHeight = menu.offsetHeight + 4;

          windowWidth = window.innerWidth;
          windowHeight = window.innerHeight;

          if ( (windowWidth - clickCoordsX) < menuWidth ) {
            menu.style.left = windowWidth - menuWidth + "px";
          } else {
            menu.style.left = clickCoordsX + "px";
          }

          if ( (windowHeight - clickCoordsY) < menuHeight ) {
            menu.style.top = windowHeight - menuHeight + "px";
          } else {
            menu.style.top = clickCoordsY + "px";
          }
        }

        function initContextMenu() {
          contextListener();
          clickListener();
          keyupListener();
          resizeListener();
        }

        initContextMenu();

        // $('#shutdown').modal('show'); // $('#shutdown').modal('hide');


        $scope.ownershipModal = function () {
            $scope.folderPathErrors = {};
            $scope.folderEditor.$setPristine();
            $('#editIgnores textarea').val("");
            $('#transferOwnership').modal();
        };

        $scope.transferOwnershipModelView = function () {
            $http.get(urlbase + '/svc/random/string?length=10').success(function (data) {
                $scope.currentFolder = angular.copy($scope.folderDefaults);
                $scope.currentFolder.id = (data.random.substr(0, 5) + '-' + data.random.substr(5, 5)).toLowerCase();
                $scope.editingExisting = false;
                $scope.currentFolder.selectedCategories = "Default";
                $scope.currentFolder.justViewFileInfo = false;
                $scope.ownershipModal();
            });
        };

        $scope.showFileInfo = function () {
            $http.get(urlbase + '/svc/random/string?length=10').success(function (data) {
                $scope.currentFolder = angular.copy($scope.folderDefaults);
                $scope.currentFolder.id = (data.random.substr(0, 5) + '-' + data.random.substr(5, 5)).toLowerCase();
                $scope.editingExisting = false;
                $scope.currentFolder.selectedCategories = "Default";
                $scope.currentFolder.justViewFileInfo = true;
                $scope.ownershipModal();
            });
        };

        $scope.ethereumAddressList = function () {
            // TO DO: get list of Eth addresses
            return $scope.ethereumAddresses;
        };

        $scope.transferOwnership = function () {
            $('#transferOwnership').modal('hide');
            // TO DO: get list of Eth addresses
        };

        function ethereumInfo(){
          $http.get(urlbase + '/system/ethereuminfo').success(function (data) {
            $scope.ethAddressAccount = data.ethAddressAccount;
            $scope.ethAddressNode = data.ethAddressNode;
          }).error($scope.emitHTTPError);
          $http.get(urlbase + '/system/qrdata').success(function (data) {
            $scope.qrRaw = data.qrRaw;
            $scope.qrRawID = data.qrRawID;
          }).error($scope.emitHTTPError);
        };

        $scope.getQR = function () {     
          $http.get(urlbase + '/system/qrdata').success(function (data) {
            $scope.qrRaw = data.qrRaw;
            $scope.qrRawID = data.qrRawID;
          }).error($scope.emitHTTPError);
        };

        $scope.getEthAddressAccount = function () {
          // TO DO: get list of Eth addresses
          return $scope.ethAddressAccount;
        };

        $scope.getEthAddressNode = function () {
            // TO DO: get list of Eth addresses
            return $scope.ethAddressNode;
        };

        $scope.switch2main = function () {
            $http.post(urlbase + '/geth/switch2main').success(function () {
            }).error($scope.emitHTTPError);
        };

        $scope.switch2ropsten = function () {
            $http.post(urlbase + '/geth/switch2ropsten').success(function () {
            }).error($scope.emitHTTPError);
        };

        $scope.switch2private = function () {
            $http.post(urlbase + '/geth/switch2private').success(function () {
            }).error($scope.emitHTTPError);
        };

        $scope.ethereumNetwork = function() {
          $http.get(urlbase + '/geth/ethereumnetwork').success(function (data) {
            if (data.ethereumNetwork == "main"){
              $("#main-network").css("font-weight","bold");
              $("#ropsten-network").css("font-weight","normal");
              $("#private-network").css("font-weight","normal");
              $("#main-network-circle").css("display","inline-block");
              $("#ropsten-network-circle").css("display","none");
              $("#private-network-circle").css("display","none");
            } else if (data.ethereumNetwork == "ropsten"){
              $("#ropsten-network").css("font-weight","bold");
              $("#main-network").css("font-weight","normal");
              $("#private-network").css("font-weight","normal");
              $("#ropsten-network-circle").css("display","inline-block");
              $("#main-network-circle").css("display","none");
              $("#private-network-circle").css("display","none");
            } else if (data.ethereumnetwork == "private") {
              $("#private-network").css("font-weight","bold");
              $("#main-network").css("font-weight","normal");
              $("#ropsten-network").css("font-weight","normal");
              $("#private-network-circle").css("display","inline-block");
              $("#main-network-circle").css("display","none");
              $("#ropsten-network-circle").css("display","none");
            }
          }).error($scope.emitHTTPError);
        };

        $scope.closeGraphs = function() {
          for (var i = 1; i <= 80; i++) {
            $('#'+i.toString()).hide("slow");
          }
        };

        $scope.ethereumNodeInfo = function () {
          $http.get(urlbase + '/system/ethereumnodeinfo').success(function (data) {
            $scope.ethereumnodeinfo.Enode = data.GethNodeInfoEnode;
            $scope.ethereumnodeinfo.id = data.GethNodeInfoID;
            $scope.ethereumnodeinfo.ip = data.GethNodeInfoIP;
            $scope.ethereumnodeinfo.ListenAddr = data.GethNodeInfoListenAddr;
            $scope.ethereumnodeinfo.Name = data.GethNodeInfoName;

            $scope.ethereumnodeinfo.PortsDiscovery = data.GethNodeInfoPortsDiscovery;
            $scope.ethereumnodeinfo.PortsListener = data.GethNodeInfoPortsListener;

            $scope.ethereumnodeinfo.ProtocolsDifficulty = data.GethNodeInfoProtocolsDifficulty;
            $scope.ethereumnodeinfo.ProtocolsGenesis = data.GethNodeInfoProtocolsGenesis;
            $scope.ethereumnodeinfo.ProtocolsHead = data.GethNodeInfoProtocolsHead;
            $scope.ethereumnodeinfo.ProtocolsNetwork = data.GethNodeInfoProtocolsNetwork;
          }).error($scope.emitHTTPError);
        };
});
