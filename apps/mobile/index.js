// index.js
import './polyfill'
import 'expo-router/entry'

import { registerWidgetTaskHandler } from 'react-native-android-widget'

import { portfolioWidgetTask } from './src/features/widget/widget-task'

// The home-screen widget's task: the launcher runs it while the app may be closed.
registerWidgetTaskHandler(portfolioWidgetTask)
