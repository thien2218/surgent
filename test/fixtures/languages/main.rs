extern crate alloc;

use std::collections::HashMap;
use std::fmt::{self, Display};

pub const VERSION: &str = "1.0";
static mut COUNTER: u32 = 0;

#[derive(Debug, Clone)]
pub struct Point {
    pub x: f64,
    y: f64,
}

struct Pair(u32, u32);

union Bits {
    int: u32,
    float: f32,
}

enum Shape {
    Circle { radius: f64 },
    Empty,
}

type Map = HashMap<String, u32>;

impl Point {
    const ORIGIN: f64 = 0.0;

    pub fn new(x: f64, y: f64) -> Self {
        Point { x, y }
    }
}

impl<T> Wrapper<T> {
    fn get(&self) -> &T {
        &self.0
    }
}

pub trait Draw {
    const ID: u32;

    fn draw(&self);

    fn redraw(&self) {
        self.draw();
    }
}

impl Display for Point {
    fn fmt(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        Ok(())
    }
}

pub mod geometry {
    pub fn area() -> f64 {
        0.0
    }
}

extern "C" {
    fn abs(value: i32) -> i32;
}

macro_rules! square {
    ($value:expr) => {
        $value * $value
    };
}

fn main() {
    fn helper() {}
    let local = 1;
}
