<?php
require __DIR__ . '/wp-stubs.php';
require __DIR__ . '/TestCase.php';
require dirname(__DIR__) . '/ace-wind-dashboard.php';

// Snapshot hooks the plugin registered at load time (reset() clears the live list).
ACE_Test_Env::$boot_hooks = ACE_Test_Env::$hooks;
