angular.module('dappbox.core')
    .filter('natural', function () {
        return function (input, valid) {
            return input.toFixed(decimals(input, valid));
        };
    });
