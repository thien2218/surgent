require "json"
require_relative "support/helper"
load "tasks.rb"
autoload :Parser, "parser"
Kernel.require "set"
include Comparable

VERSION = "1.0"
settings = {}
$debug = false
square = ->(value) { value * value }

def greet(name)
  "Hello #{name}"
end

module Config
  TIMEOUT = 5

  def self.load; end

  class Store
    attr_reader :name, :size
    attr_accessor :limit
    MAX = 10
    @@count = 0
    HANDLER = lambda { |item| item }
    cache = {}

    def initialize(name)
      @name = name
    end

    def self.build; end

    class << self
      def default; end
    end

    class Entry; end
  end
end

Point = Struct.new(:x, :y) do
  def to_s
    "(#{x}, #{y})"
  end
end

RSpec.describe Config::Store do
  it "stores a name" do
    expect(true).to be(true)
  end
end

task :build do
  puts "build"
end
