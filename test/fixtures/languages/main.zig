const std = @import("std");
const mem = std.mem;
const c = @cImport({
    @cInclude("stdio.h");
});
usingnamespace @import("extra.zig");

pub const max_items: u32 = 64;
var counter: u32 = 0;

pub const Point = struct {
    x: i32,
    y: i32 = 0,

    const Self = @This();
    const Inner = struct { depth: u8 };

    pub fn init() Point {
        const origin = 0;
        return .{ .x = origin };
    }
};

const Color = enum {
    red,
    green,

    fn isWarm(self: Color) bool {
        return self == .red;
    }
};

const Number = union(enum) {
    int: i64,
    float: f64,
};

const Handle = opaque {};
const Failure = error{ Missing, Invalid };

fn List(comptime T: type) type {
    return struct {
        items: []T,

        pub fn len(self: @This()) usize {
            return self.items.len;
        }
    };
}

pub fn main() void {
    const local = 1;
    _ = local;
}

test "point starts at origin" {}
