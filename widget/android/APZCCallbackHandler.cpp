/* -*- Mode: c++; c-basic-offset: 4; tab-width: 20; indent-tabs-mode: nil; -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "APZCCallbackHandler.h"
#include "mozilla/layers/APZCCallbackHelper.h"
#include "mozilla/layers/APZCTreeManager.h"
#include "nsAppShell.h"
#include "nsLayoutUtils.h"
#include "nsPrintfCString.h"
#include "nsThreadUtils.h"
#include "base/message_loop.h"
#include "nsWindow.h"
#include "nsIInterfaceRequestorUtils.h"
#include "AndroidBridge.h"
#include "nsIContent.h"

using mozilla::layers::APZCCallbackHelper;
using mozilla::layers::APZCTreeManager;
using mozilla::layers::FrameMetrics;
using mozilla::layers::ScrollableLayerGuid;

namespace mozilla {
namespace widget {
namespace android {

StaticRefPtr<APZCCallbackHandler>         APZCCallbackHandler::sInstance;

NativePanZoomController::GlobalRef APZCCallbackHandler::sNativePanZoomController = nullptr;

NativePanZoomController::LocalRef
APZCCallbackHandler::SetNativePanZoomController(NativePanZoomController::Param obj)
{
    NativePanZoomController::LocalRef old = sNativePanZoomController;
    sNativePanZoomController = obj;
    return old;
}

void
APZCCallbackHandler::NotifyDefaultPrevented(uint64_t aInputBlockId,
                                            bool aDefaultPrevented)
{
    if (!AndroidBridge::IsJavaUiThread()) {
        // The notification must reach the APZ on the Java UI thread (aka the
        // APZ "controller" thread) but we get it from the Gecko thread, so we
        // have to throw it onto the other thread.
        AndroidBridge::Bridge()->PostTaskToUiThread(NewRunnableMethod(
            this, &APZCCallbackHandler::NotifyDefaultPrevented,
            aInputBlockId, aDefaultPrevented), 0);
        return;
    }

    MOZ_ASSERT(AndroidBridge::IsJavaUiThread());
    APZCTreeManager* controller = nsWindow::GetAPZCTreeManager();
    if (controller) {
        controller->ContentReceivedInputBlock(aInputBlockId, aDefaultPrevented);
    }
}

void
APZCCallbackHandler::PostDelayedTask(Task* aTask, int aDelayMs)
{
    AndroidBridge::Bridge()->PostTaskToUiThread(aTask, aDelayMs);
}

} // namespace android
} // namespace widget
} // namespace mozilla
