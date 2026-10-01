// The native half of electron/printer-driver.ts: what Zadig does, callable
// from the app.
//
// Replaces src/generator.cpp of winusb-driver-generator (Apache-2.0, see
// scripts/build-winusb.mjs) before it is compiled. The published file cannot be
// used as it is:
//
//  - It only looks at devices with no driver at all. A receipt printer is never
//    one: Windows gives it usbprint the moment it is plugged in, so the stock
//    associate() installs a driver for nothing and the printer stays where it
//    was.
//  - Its listing writes every device into the device itself rather than into
//    the array, so it always returns [].
//  - It installs into a path relative to the working directory, which for an
//    elevated process is System32.
//
// So: list every device with its current driver and USB class, and swap one —
// by VID/PID, and interface on a composite device — into a directory the caller
// names.

#include <napi.h>
#include <libwdi.h>
#include <string.h>
#include <string>

static const char *orEmpty(const char *s) { return s != NULL ? s : ""; }

// A composite device appears twice: the parent, held by usbccgp, and the
// interface that actually needs the driver. Only ever touch the latter.
static bool isCompositeParent(const struct wdi_device_info *d) {
  return d->driver != NULL && _stricmp(d->driver, "usbccgp") == 0;
}

static int listAll(struct wdi_device_info **result) {
  struct wdi_options_create_list options = { 0 };
  options.list_all = TRUE;
  return wdi_create_list(result, &options);
}

// [{ vid, pid, driver, composite, mi, compatible }] for every USB device present.
// `compatible` is Windows' compatible ID, e.g. USB\Class_07&SubClass_01&Prot_02
// — class 07 is a printer.
Napi::Value ListDevices(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  Napi::Array devices = Napi::Array::New(env);
  wdi_set_log_level(WDI_LOG_LEVEL_WARNING);

  struct wdi_device_info *head = NULL;
  int code = listAll(&head);
  if (code == WDI_ERROR_NO_DEVICE) return devices;
  if (code != WDI_SUCCESS) {
    Napi::Error::New(env, wdi_strerror(code)).ThrowAsJavaScriptException();
    return env.Null();
  }

  uint32_t i = 0;
  for (struct wdi_device_info *d = head; d != NULL; d = d->next) {
    Napi::Object o = Napi::Object::New(env);
    o.Set("vid", Napi::Number::New(env, d->vid));
    o.Set("pid", Napi::Number::New(env, d->pid));
    o.Set("driver", Napi::String::New(env, orEmpty(d->driver)));
    o.Set("composite", Napi::Boolean::New(env, d->is_composite != FALSE));
    o.Set("mi", Napi::Number::New(env, d->mi));
    o.Set("compatible", Napi::String::New(env, orEmpty(d->compatible_id)));
    devices.Set(i++, o);
  }
  wdi_destroy_list(head);
  return devices;
}

// associate(vid, pid, mi, description, dir): put WinUSB on that device. `mi`
// picks the interface of a composite device; -1 for one that is not composite. Needs to
// run elevated — without admin libwdi skips signing the driver, and Windows
// 10/11 then refuses it.
Napi::Value Associate(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();
  if (info.Length() != 5 || !info[0].IsNumber() || !info[1].IsNumber() ||
      !info[2].IsNumber() || !info[3].IsString() || !info[4].IsString()) {
    Napi::TypeError::New(env, "associate(vid, pid, mi, description, dir)")
      .ThrowAsJavaScriptException();
    return env.Null();
  }
  const unsigned short vid = (unsigned short)info[0].As<Napi::Number>().Uint32Value();
  const unsigned short pid = (unsigned short)info[1].As<Napi::Number>().Uint32Value();
  const int mi = info[2].As<Napi::Number>().Int32Value();
  std::string desc = info[3].As<Napi::String>().Utf8Value();
  std::string dir = info[4].As<Napi::String>().Utf8Value();
  const char *const INF_NAME = "usb_device.inf";

  wdi_set_log_level(WDI_LOG_LEVEL_WARNING);

  struct wdi_device_info *head = NULL;
  int code = listAll(&head);
  if (code != WDI_SUCCESS && code != WDI_ERROR_NO_DEVICE) {
    Napi::Error::New(env, wdi_strerror(code)).ThrowAsJavaScriptException();
    return env.Null();
  }

  struct wdi_device_info *found = NULL;
  for (struct wdi_device_info *d = head; d != NULL; d = d->next) {
    if (d->vid != vid || d->pid != pid || isCompositeParent(d)) continue;
    if (mi >= 0 && (!d->is_composite || d->mi != mi)) continue;
    found = d;
    break;
  }
  if (found == NULL) {
    if (head != NULL) wdi_destroy_list(head);
    Napi::Error::New(env, "device not connected").ThrowAsJavaScriptException();
    return env.Null();
  }

  // A copy with our own description. The list owns the original's strings and
  // frees them in wdi_destroy_list, so the copy must not outlive it.
  struct wdi_device_info device = *found;
  device.next = NULL;
  device.desc = &desc[0];

  struct wdi_options_prepare_driver prepare = { 0 };
  prepare.driver_type = WDI_WINUSB;
  code = wdi_prepare_driver(&device, dir.c_str(), INF_NAME, &prepare);
  if (code == WDI_SUCCESS) code = wdi_install_driver(&device, dir.c_str(), INF_NAME, NULL);

  wdi_destroy_list(head);
  if (code != WDI_SUCCESS) {
    Napi::Error::New(env, wdi_strerror(code)).ThrowAsJavaScriptException();
    return env.Null();
  }
  return env.Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("listDevices", Napi::Function::New(env, ListDevices));
  exports.Set("associate", Napi::Function::New(env, Associate));
  return exports;
}

NODE_API_MODULE(Generator, Init)
